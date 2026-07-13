declare const __PLUGIN_VERSION__: string;

import { FocusEvents, SidebarEvents, type ReactRNPlugin, WindowEvents } from '@remnote/plugin-sdk';
import { RemAdapter, type UpdateNoteRichTextToken } from '../api/rem-adapter';
import {
  type BridgeRequest,
  type CompanionInfo,
  type ConnectionStatus,
  type ReconnectMetadata,
  type RetryPhase,
  WebSocketClient,
} from './websocket-client';
import { type AutomationBridgeSettings, readAutomationBridgeSettings } from '../settings';
import {
  registerDevToolsBridgeExecutor,
  type DevToolsExecutorConfig,
} from '../widgets/devtools-bridge-executor';
import { registerBridgeRuntimeUiBridge } from '../widgets/runtime-ui-bridge';
import { withScopedLogPrefix } from '../logging';

export interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'error' | 'warn' | 'success';
}

export interface SessionStats {
  created: number;
  updated: number;
  journal: number;
  searches: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  action: 'create' | 'update' | 'journal' | 'search' | 'read';
  titles: string[];
  remIds?: string[];
}

export type BridgeInstallMode = 'development' | 'marketplace';

export interface BridgeRuntimeSnapshot {
  status: ConnectionStatus;
  retryPhase: RetryPhase;
  bridgeVersion: string;
  installMode: BridgeInstallMode;
  companion?: CompanionInfo;
  wsUrl: string;
  logs: LogEntry[];
  stats: SessionStats;
  history: HistoryEntry[];
  lastConnectedAt?: number;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  nextRetryAt?: number;
  lastRetryDelayMs?: number;
  lastDisconnectReason?: string;
}

export interface BridgeRuntime {
  getSnapshot(): BridgeRuntimeSnapshot;
  subscribe(listener: (snapshot: BridgeRuntimeSnapshot) => void): () => void;
  reconnect(reason?: string): void;
  nudgeReconnect(reason?: string): void;
  updateSettings(settings: Partial<AutomationBridgeSettings>): void;
  shutdown(): void;
}

export const MAX_LOGS = 50;
export const MAX_HISTORY = 10;
export const AUTO_NUDGE_COOLDOWN_MS = 15_000;

export function getBridgeInstallMode(rootUrl: string | undefined): BridgeInstallMode {
  return rootUrl?.startsWith('http://localhost:8080/') ? 'development' : 'marketplace';
}

function formatCompanionKind(kind: CompanionInfo['kind']): string {
  return kind === 'cli' ? 'CLI' : 'MCP server';
}

class BridgeRuntimeController implements BridgeRuntime {
  private readonly adapter: RemAdapter;
  private readonly listeners = new Set<(snapshot: BridgeRuntimeSnapshot) => void>();
  private wsClient: WebSocketClient;
  private unregisterDevTools: (() => void) | null = null;
  private unregisterUiBridge: (() => void) | null = null;
  private windowListeners: Array<() => void> = [];
  private settings: AutomationBridgeSettings;
  private status: ConnectionStatus = 'disconnected';
  private retryPhase: RetryPhase = 'idle';
  private logs: LogEntry[] = [];
  private stats: SessionStats = {
    created: 0,
    updated: 0,
    journal: 0,
    searches: 0,
  };
  private history: HistoryEntry[] = [];
  private historyIdCounter = 0;
  private lastConnectedAt?: number;
  private lastAutoNudgeAt?: number;
  private lastSuppressedAutoNudgeAt?: number;
  private readonly bridgeVersion = __PLUGIN_VERSION__;
  private readonly installMode: BridgeInstallMode;
  private companionInfo?: CompanionInfo;

  constructor(
    private readonly plugin: ReactRNPlugin,
    settings: AutomationBridgeSettings
  ) {
    this.settings = settings;
    this.installMode = getBridgeInstallMode(plugin.rootURL);
    this.adapter = new RemAdapter(plugin, settings);
    this.wsClient = this.createWebSocketClient(settings.wsUrl);
    this.wsClient.setMessageHandler(this.handleRequest);
    this.adapter.updateSettings(settings);
  }

  start(): void {
    console.log(withScopedLogPrefix('runtime', 'Runtime start'));
    this.addLog('RemAdapter initialized', 'success');
    this.registerDevToolsExecutor();
    this.registerUiBridge();
    this.registerLifecycleNudges();
    this.wsClient.connect();
    this.addLog(`Connecting to automation bridge server at ${this.settings.wsUrl}...`, 'info');
  }

  getSnapshot(): BridgeRuntimeSnapshot {
    const reconnectMetadata: ReconnectMetadata = this.wsClient.getReconnectMetadata();

    return {
      status: this.status,
      retryPhase: this.retryPhase,
      bridgeVersion: this.bridgeVersion,
      installMode: this.installMode,
      companion: this.companionInfo,
      wsUrl: this.settings.wsUrl,
      logs: [...this.logs],
      stats: { ...this.stats },
      history: [...this.history],
      lastConnectedAt: this.lastConnectedAt,
      reconnectAttempts: reconnectMetadata.reconnectAttempts,
      maxReconnectAttempts: reconnectMetadata.maxReconnectAttempts,
      nextRetryAt: reconnectMetadata.nextRetryAt,
      lastRetryDelayMs: reconnectMetadata.lastRetryDelayMs,
      lastDisconnectReason: reconnectMetadata.lastDisconnectReason,
    };
  }

  subscribe(listener: (snapshot: BridgeRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  reconnect(reason = 'manual request'): void {
    console.log(withScopedLogPrefix('runtime', `Reconnect requested: ${reason}`));
    this.addLog(`Manual reconnection requested (${reason})`, 'info');
    this.wsClient.reconnect();
  }

  nudgeReconnect(reason = 'activity'): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    const now = Date.now();
    if (this.lastAutoNudgeAt !== undefined && now - this.lastAutoNudgeAt < AUTO_NUDGE_COOLDOWN_MS) {
      if (
        this.lastSuppressedAutoNudgeAt === undefined ||
        now - this.lastSuppressedAutoNudgeAt >= AUTO_NUDGE_COOLDOWN_MS
      ) {
        console.log(
          withScopedLogPrefix(
            'runtime',
            `Auto reconnect nudge suppressed during cooldown: ${reason}`
          )
        );
        this.addLog(`Auto reconnect nudge suppressed during cooldown (${reason})`, 'info');
        this.lastSuppressedAutoNudgeAt = now;
      }
      return;
    }

    this.lastAutoNudgeAt = now;
    this.lastSuppressedAutoNudgeAt = undefined;
    console.log(withScopedLogPrefix('runtime', `Auto reconnect nudged: ${reason}`));
    this.addLog(`Auto reconnect nudged (${reason})`, 'info');

    if (this.retryPhase === 'standby') {
      this.addLog(`Resuming faster retries from standby (${reason})`, 'info');
      this.wsClient.wakeReconnect(reason);
      return;
    }

    this.wsClient.nudgeReconnect(reason);
  }

  updateSettings(nextSettings: Partial<AutomationBridgeSettings>): void {
    const settingKeys = Object.keys(nextSettings);
    if (settingKeys.length > 0) {
      console.log(
        withScopedLogPrefix('runtime', `Settings update received: ${settingKeys.join(', ')}`)
      );
    }

    const previousWsUrl = this.settings.wsUrl;
    this.settings = { ...this.settings, ...nextSettings };
    this.adapter.updateSettings(this.settings);

    if (this.settings.wsUrl !== previousWsUrl) {
      this.addLog(`WebSocket URL updated to ${this.settings.wsUrl}`, 'info');
      this.wsClient.disconnect();
      this.wsClient = this.createWebSocketClient(this.settings.wsUrl);
      this.wsClient.setMessageHandler(this.handleRequest);
      this.wsClient.connect();
      this.addLog(`Connecting to automation bridge server at ${this.settings.wsUrl}...`, 'info');
    }

    this.emit();
  }

  shutdown(): void {
    console.log(withScopedLogPrefix('runtime', 'Runtime shutdown'));
    this.unregisterDevTools?.();
    this.unregisterDevTools = null;
    this.unregisterUiBridge?.();
    this.unregisterUiBridge = null;
    this.windowListeners.forEach((cleanup) => cleanup());
    this.windowListeners = [];
    this.wsClient.disconnect();
    this.listeners.clear();
  }

  private createWebSocketClient(url: string): WebSocketClient {
    return new WebSocketClient({
      url,
      pluginVersion: __PLUGIN_VERSION__,
      maxReconnectAttempts: 10,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      standbyReconnectDelay: 10 * 60 * 1000,
      onStatusChange: (status) => {
        console.log(withScopedLogPrefix('runtime', `WebSocket status -> ${status}`));
        this.status = status;
        if (status === 'connected') {
          this.lastConnectedAt = Date.now();
        }
        this.emit();
      },
      onRetryPhaseChange: (phase) => {
        console.log(withScopedLogPrefix('runtime', `Retry phase -> ${phase}`));
        this.retryPhase = phase;
        this.emit();
      },
      onCompanionInfoChange: (info) => {
        this.companionInfo = info;
        if (info) {
          this.addLog(
            `Companion ready: ${formatCompanionKind(info.kind)} v${info.version}`,
            'success'
          );
          return;
        }
        this.emit();
      },
      onLog: (message, level) => {
        this.addLog(message, level);
      },
    });
  }

  private addLog(message: string, level: LogEntry['level'] = 'info'): void {
    this.logs = [...this.logs, { timestamp: new Date(), message, level }].slice(-MAX_LOGS);
    this.emit();
  }

  private addHistoryEntry(
    action: HistoryEntry['action'],
    titles: string[],
    remIds?: string[]
  ): void {
    this.history = [
      { id: `h-${++this.historyIdCounter}`, timestamp: new Date(), action, titles, remIds },
      ...this.history,
    ].slice(0, MAX_HISTORY);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private readonly handleRequest = async (request: BridgeRequest): Promise<unknown> => {
    const payload = request.payload;
    this.addLog(`Received action: ${request.action}`, 'info');

    switch (request.action) {
      case 'create_note': {
        const result = await this.adapter.createNote({
          title: payload.title as string | undefined,
          content: payload.content as string | undefined,
          parentId: payload.parentId as string | undefined,
          tagRemIds: payload.tagRemIds as string[] | undefined,
          asDocument: payload.asDocument as boolean | undefined,
        });
        this.stats = { ...this.stats, created: this.stats.created + 1 };
        this.addHistoryEntry('create', result.titles || ['Note'], result.remIds);
        this.emit();
        return result;
      }

      case 'append_journal': {
        const result = await this.adapter.appendJournal({
          content: payload.content as string,
          timestamp: payload.timestamp as boolean | undefined,
          tagRemIds: payload.tagRemIds as string[] | undefined,
        });
        this.stats = { ...this.stats, journal: this.stats.journal + 1 };
        this.addHistoryEntry('journal', result.titles, result.remIds);
        this.emit();
        return result;
      }

      case 'search': {
        const result = await this.adapter.search({
          query: payload.query as string,
          parentRemId: typeof payload.parentRemId === 'string' ? payload.parentRemId : undefined,
          limit: payload.limit as number | undefined,
          cursor: typeof payload.cursor === 'string' ? payload.cursor : undefined,
          contentMode: payload.contentMode as 'none' | 'markdown' | 'structured' | undefined,
          depth: payload.depth as number | undefined,
          childLimit: payload.childLimit as number | undefined,
          maxContentLength: payload.maxContentLength as number | undefined,
          ancestorDepth: payload.ancestorDepth as number | undefined,
          view: payload.view as 'compact' | 'standard' | 'full' | undefined,
        });
        this.stats = { ...this.stats, searches: this.stats.searches + 1 };
        this.addHistoryEntry('search', [`Search: "${payload.query}"`]);
        this.emit();
        return result;
      }

      case 'search_by_tag': {
        const result = await this.adapter.searchByTag({
          tagRemId: payload.tagRemId as string,
          resultMode: payload.resultMode as 'context' | 'tagged' | undefined,
          limit: payload.limit as number | undefined,
          cursor: typeof payload.cursor === 'string' ? payload.cursor : undefined,
          contentMode: payload.contentMode as 'none' | 'markdown' | 'structured' | undefined,
          depth: payload.depth as number | undefined,
          childLimit: payload.childLimit as number | undefined,
          maxContentLength: payload.maxContentLength as number | undefined,
          ancestorDepth: payload.ancestorDepth as number | undefined,
          view: payload.view as 'compact' | 'standard' | 'full' | undefined,
        });
        this.stats = { ...this.stats, searches: this.stats.searches + 1 };
        this.addHistoryEntry('search', [`Search by tag Rem ID: "${payload.tagRemId}"`]);
        this.emit();
        return result;
      }

      case 'read_note': {
        const result = await this.adapter.readNote({
          remId: payload.remId as string,
          depth: payload.depth as number | undefined,
          contentMode: payload.contentMode as 'none' | 'markdown' | 'structured' | undefined,
          childLimit: payload.childLimit as number | undefined,
          maxContentLength: payload.maxContentLength as number | undefined,
          ancestorDepth: payload.ancestorDepth as number | undefined,
          view: payload.view as 'compact' | 'standard' | 'full' | undefined,
        });
        this.addHistoryEntry('read', [result.title], [result.remId]);
        return result;
      }

      case 'list_children': {
        const result = await this.adapter.listChildren({
          parentRemId: payload.parentRemId as string,
          limit: payload.limit as number | undefined,
          cursor: typeof payload.cursor === 'string' ? payload.cursor : undefined,
          ancestorDepth: payload.ancestorDepth as number | undefined,
          view: payload.view as 'compact' | 'standard' | 'full' | undefined,
        });
        this.addHistoryEntry('read', [`Children of ${payload.parentRemId}`]);
        return result;
      }

      case 'read_table': {
        const result = await this.adapter.readTable({
          tableRemId: payload.tableRemId as string | undefined,
          tableTitle: payload.tableTitle as string | undefined,
          limit: payload.limit as number | undefined,
          offset: payload.offset as number | undefined,
          propertyFilter: payload.propertyFilter as string[] | undefined,
        });
        this.addHistoryEntry('read', [result.tableName], [result.tableId]);
        return result;
      }

      case 'manage_portal': {
        const result = await this.adapter.managePortal({
          operation: payload.operation as 'create' | 'add' | 'remove' | 'read',
          portalRemId: payload.portalRemId as string | undefined,
          remId: payload.remId as string | undefined,
          title: payload.title as string | undefined,
          parentRemId: payload.parentRemId as string | undefined,
        });
        return result;
      }

      case 'create_table': {
        return await this.adapter.createTable({
          title: payload.title as string,
          parentRemId: payload.parentRemId as string | undefined,
          columns: payload.columns as Array<{ name: string; type?: string }>,
        });
      }

      case 'create_table_row': {
        return await this.adapter.createTableRow({
          tableRemId: payload.tableRemId as string,
          title: payload.title as string,
          parentRemId: payload.parentRemId as string | undefined,
          values: payload.values as Record<
            string,
            | { kind: 'text'; text: string }
            | { kind: 'rem_reference'; remId: string }
            | { kind: 'clear' }
          >,
        });
      }

      case 'set_rem_features': {
        return await this.adapter.setRemFeatures({
          remId: payload.remId as string,
          todoStatus: payload.todoStatus as 'todo' | 'finished' | 'clear' | undefined,
          codeLanguage: payload.codeLanguage as string | null | undefined,
          isQuote: payload.isQuote as boolean | undefined,
          isListItem: payload.isListItem as boolean | undefined,
          templateRemId: payload.templateRemId as string | null | undefined,
        });
      }

      case 'create_link_rem': {
        return await this.adapter.createLinkRem({
          url: payload.url as string,
          title: payload.title as string | undefined,
          parentRemId: payload.parentRemId as string | undefined,
        });
      }

      case 'update_note': {
        const result = await this.adapter.updateNote({
          remId: payload.remId as string,
          title: payload.title as string | undefined,
          appendContent: payload.appendContent as string | undefined,
          replaceContent: payload.replaceContent as string | undefined,
          addTags: payload.addTags as string[] | undefined,
          removeTags: payload.removeTags as string[] | undefined,
          addAliases: payload.addAliases as string[] | undefined,
          removeAliases: payload.removeAliases as string[] | undefined,
          mergeFromRemId: payload.mergeFromRemId as string | undefined,
          richText: payload.richText as UpdateNoteRichTextToken[] | undefined,
          richTextBack: payload.richTextBack as UpdateNoteRichTextToken[] | undefined,
          frontCardHint: payload.frontCardHint as string | undefined,
          backCardHint: payload.backCardHint as string | undefined,
          setParentId: payload.setParentId as string | undefined,
          setIsDocument: payload.setIsDocument as boolean | undefined,
          setIsFolder: payload.setIsFolder as boolean | undefined,
          removeAfter: payload.removeAfter as boolean | undefined,
        });
        this.stats = { ...this.stats, updated: this.stats.updated + 1 };
        this.addHistoryEntry('update', result.titles || ['Note updated'], result.remIds);
        this.emit();
        return result;
      }

      case 'set_document_status': {
        const result = await this.adapter.setDocumentStatus({
          remId: payload.remId as string,
          isDocument: payload.isDocument as boolean,
          dryRun: payload.dryRun as boolean | undefined,
          expectedOldRemType: payload.expectedOldRemType as
            | 'document'
            | 'dailyDocument'
            | 'concept'
            | 'descriptor'
            | 'portal'
            | 'text'
            | undefined,
        });
        if (result.changed) {
          this.stats = { ...this.stats, updated: this.stats.updated + 1 };
          this.addHistoryEntry(
            'update',
            [`Document status updated: ${result.title}`],
            [result.remId]
          );
          this.emit();
        }
        return result;
      }

      case 'insert_children': {
        const result = await this.adapter.insertChildren({
          parentRemId: payload.parentRemId as string,
          content: payload.content as string,
          position: payload.position as 'first' | 'last' | 'before' | 'after',
          siblingRemId: payload.siblingRemId as string | undefined,
        });
        this.stats = { ...this.stats, updated: this.stats.updated + 1 };
        this.addHistoryEntry('create', result.titles || ['Children inserted'], result.remIds);
        this.emit();
        return result;
      }

      case 'move_note': {
        const result = await this.adapter.moveNote({
          remId: payload.remId as string,
          newParentRemId: payload.newParentRemId as string,
          position: payload.position as 'first' | 'last' | 'before' | 'after' | undefined,
          siblingRemId: payload.siblingRemId as string | undefined,
          dryRun: payload.dryRun as boolean | undefined,
          expectedOldParentRemId: payload.expectedOldParentRemId as string | undefined,
          ancestorDepth: payload.ancestorDepth as number | undefined,
        });
        if (!result.dryRun) {
          this.stats = { ...this.stats, updated: this.stats.updated + 1 };
          this.addHistoryEntry('update', [`Moved ${result.title}`], [result.remId]);
          this.emit();
        }
        return result;
      }

      case 'replace_children': {
        const result = await this.adapter.replaceChildren({
          parentRemId: payload.parentRemId as string,
          content: payload.content as string,
        });
        this.stats = { ...this.stats, updated: this.stats.updated + 1 };
        this.addHistoryEntry('update', result.titles || ['Children replaced'], result.remIds);
        this.emit();
        return result;
      }

      case 'update_tags': {
        const result = await this.adapter.updateTags({
          remId: payload.remId as string,
          addTagRemIds: payload.addTagRemIds as string[] | undefined,
          removeTagRemIds: payload.removeTagRemIds as string[] | undefined,
        });
        this.stats = { ...this.stats, updated: this.stats.updated + 1 };
        this.addHistoryEntry('update', ['Tags updated'], result.remIds);
        this.emit();
        return result;
      }

      case 'set_property': {
        const result = await this.adapter.setProperty({
          remId: payload.remId as string,
          tagRemId: payload.tagRemId as string,
          propertyRemId: payload.propertyRemId as string,
          value: payload.value as
            | { kind: 'text'; text: string }
            | { kind: 'rem_reference'; remId: string }
            | { kind: 'clear' },
        });
        this.stats = { ...this.stats, updated: this.stats.updated + 1 };
        this.addHistoryEntry('update', ['Property updated'], [result.remId]);
        this.emit();
        return result;
      }

      case 'get_status':
        return await this.adapter.getStatus();

      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  };

  private registerDevToolsExecutor(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const config: DevToolsExecutorConfig = {
      target: window,
      execute: this.handleRequest,
      onLog: (message, level) => this.addLog(message, level ?? 'info'),
    };

    this.unregisterDevTools = registerDevToolsBridgeExecutor(config);

    this.addLog('DevTools bridge executor ready (event-based)', 'info');
  }

  private registerLifecycleNudges(): void {
    const addPluginListener = (eventId: string, reason: string, listenerKey?: string): void => {
      const callback = () => {
        this.nudgeReconnect(reason);
      };
      this.plugin.event.addListener(eventId, listenerKey, callback);
      this.windowListeners.push(() =>
        this.plugin.event.removeListener(eventId, listenerKey, callback)
      );
    };

    addPluginListener(WindowEvents.FocusedPaneChange, 'focused pane changed');
    addPluginListener(FocusEvents.FocusedRemChange, 'focused rem changed');
    addPluginListener(FocusEvents.FocusedPortalChange, 'focused portal changed');
    addPluginListener(SidebarEvents.ClickSidebarItem, 'sidebar item clicked');

    if (typeof window === 'undefined') {
      return;
    }

    const focusListener = () => {
      this.nudgeReconnect('window focus');
    };
    window.addEventListener('focus', focusListener);
    this.windowListeners.push(() => window.removeEventListener('focus', focusListener));

    const onlineListener = () => {
      this.nudgeReconnect('browser online');
    };
    window.addEventListener('online', onlineListener);
    this.windowListeners.push(() => window.removeEventListener('online', onlineListener));

    if (typeof document !== 'undefined') {
      const visibilityListener = () => {
        if (!document.hidden) {
          this.nudgeReconnect('tab visible');
        }
      };
      document.addEventListener('visibilitychange', visibilityListener);
      this.windowListeners.push(() =>
        document.removeEventListener('visibilitychange', visibilityListener)
      );
    }
  }

  private registerUiBridge(): void {
    this.unregisterUiBridge = registerBridgeRuntimeUiBridge({
      plugin: this.plugin,
      runtime: this,
    });
  }
}

let runtime: BridgeRuntimeController | null = null;

export async function initializeBridgeRuntime(plugin: ReactRNPlugin): Promise<BridgeRuntime> {
  if (runtime) {
    return runtime;
  }

  const settings = await readAutomationBridgeSettings(plugin);
  runtime = new BridgeRuntimeController(plugin, settings);
  runtime.start();
  return runtime;
}

export function getBridgeRuntime(): BridgeRuntime | null {
  return runtime;
}

export function shutdownBridgeRuntime(): void {
  runtime?.shutdown();
  runtime = null;
}
