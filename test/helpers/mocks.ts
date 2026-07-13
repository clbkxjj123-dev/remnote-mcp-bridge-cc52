/**
 * Mock implementations for testing
 */
import { vi } from 'vitest';
import type { RichTextInterface, PluginRem, SetRemType } from '@remnote/plugin-sdk';
import { MessagingEvents, RemType } from '@remnote/plugin-sdk';
import { BridgeRequest } from '../../src/bridge/websocket-client';

/**
 * Mock WebSocket implementation
 */
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static mode: 'open' | 'close' | 'hang' = 'open';

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    if (MockWebSocket.mode === 'open') {
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
      }, 0);
      return;
    }

    if (MockWebSocket.mode === 'close') {
      setTimeout(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({
          code: 1006,
          reason: 'Mock connection failure',
        } as CloseEvent);
      }, 0);
    }
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = {
      code: code ?? 1000,
      reason: reason ?? '',
    } as CloseEvent;
    this.onclose?.(event);
  }

  // Helper to simulate receiving a message
  simulateMessage(data: string | object): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    const event = new MessageEvent('message', { data: message });
    this.onmessage?.(event);
  }

  // Helper to simulate connection error
  simulateError(): void {
    const event = new Event('error');
    this.onerror?.(event);
  }

  static reset(): void {
    MockWebSocket.instances = [];
    MockWebSocket.mode = 'open';
  }
}

/**
 * Mock Rem implementation
 */
export class MockRem {
  _id: string;
  text: RichTextInterface;
  backText?: RichTextInterface;
  type: RemType = RemType.DEFAULT_TYPE;
  private children: MockRem[] = [];
  private tags: string[] = [];
  private parent: MockRem | null = null;
  private _isDocument = false;
  private _powerups: string[] = [];
  private _practiceDirection: 'forward' | 'backward' | 'both' | 'none' = 'none';
  private _cardTypes: string[] = [];
  private _aliases: MockRem[] = [];
  private _taggedRems: MockRem[] = [];
  private _tagRems: MockRem[] = [];
  private _isPowerupProperty = false;
  private _isPowerupPropertyListItem = false;
  private _isPowerupSlot = false;
  private _isPowerupEnum = false;
  private _isProperty = false;
  private _propertyType: string | undefined;
  private _tagPropertyValues = new Map<string, RichTextInterface>();
  private _isTable = false;
  private _portalIncluded: MockRem[] = [];
  private _isQuote = false;
  private _isListItem = false;
  private _powerupProperties = new Map<string, RichTextInterface>();

  constructor(id: string, text: string) {
    this._id = id;
    this.text = [text];
    MockRem.registry.set(id, this);
  }

  /** Configure mock to behave as a document */
  setIsDocumentMock(val: boolean): void {
    this._isDocument = val;
  }

  /** Add a powerup code (e.g. BuiltInPowerupCodes.DailyDocument) */
  addPowerupMock(code: string): void {
    this._powerups.push(code);
  }

  /** Set the mock practice direction */
  setPracticeDirectionMock(dir: 'forward' | 'backward' | 'both' | 'none'): void {
    this._practiceDirection = dir;
  }

  setCardTypesMock(types: string[]): void {
    this._cardTypes = types;
  }

  async getCards(): Promise<Array<{ type: string }>> {
    return this._cardTypes.map((type) => ({ type }));
  }

  /** Set mock aliases (pass RichTextInterface arrays which become MockRem .text) */
  setAliasesMock(aliases: RichTextInterface[]): void {
    this._aliases = aliases.map((rt, idx) => {
      const aliasRem = new MockRem(`${this._id}_alias_${idx}`, '');
      aliasRem.text = rt;
      return aliasRem;
    });
  }

  async getAliases(): Promise<MockRem[]> {
    return this._aliases;
  }

  async getOrCreateAliasWithText(aliasText: RichTextInterface): Promise<MockRem> {
    const aliasRem = new MockRem(`${this._id}_alias_${this._aliases.length}`, '');
    aliasRem.text = aliasText;
    this._aliases.push(aliasRem);
    return aliasRem;
  }

  /** IDs passed to mergeAndSetAlias, for test assertions */
  mergedFromRemIds: string[] = [];

  async mergeAndSetAlias(remToMergeIntoThisOne: string | MockRem): Promise<void> {
    const sourceId =
      typeof remToMergeIntoThisOne === 'string' ? remToMergeIntoThisOne : remToMergeIntoThisOne._id;
    this.mergedFromRemIds.push(sourceId);
  }

  setTaggedRemsMock(taggedRems: MockRem[]): void {
    this._taggedRems = taggedRems;
  }

  async taggedRem(): Promise<MockRem[]> {
    return this._taggedRems;
  }

  setTagRemsMock(tagRems: MockRem[]): void {
    this._tagRems = tagRems;
  }

  async getTagRems(): Promise<MockRem[]> {
    return this._tagRems;
  }

  setPowerupPropertyMock(val: boolean): void {
    this._isPowerupProperty = val;
  }

  setPowerupPropertyListItemMock(val: boolean): void {
    this._isPowerupPropertyListItem = val;
  }

  setPowerupSlotMock(val: boolean): void {
    this._isPowerupSlot = val;
  }

  setPowerupEnumMock(val: boolean): void {
    this._isPowerupEnum = val;
  }

  async isDocument(): Promise<boolean> {
    return this._isDocument;
  }

  async setIsDocument(isDocument: boolean): Promise<void> {
    this._isDocument = isDocument;
  }

  private _isFolder = false;

  async isFolder(): Promise<boolean> {
    return this._isFolder;
  }

  async setIsFolder(isFolder: boolean): Promise<void> {
    this._isFolder = isFolder;
  }

  async hasPowerup(code: string): Promise<boolean> {
    return this._powerups.includes(code);
  }

  async addPowerup(code: string): Promise<void> {
    if (!this._powerups.includes(code)) this._powerups.push(code);
  }

  async removePowerup(code: string): Promise<void> {
    this._powerups = this._powerups.filter((value) => value !== code);
    for (const key of [...this._powerupProperties.keys()]) {
      if (key.startsWith(`${code}:`)) this._powerupProperties.delete(key);
    }
  }

  async setPowerupProperty(code: string, slot: string, value: RichTextInterface): Promise<void> {
    this._powerupProperties.set(`${code}:${slot}`, value);
  }

  async getPowerupProperty(code: string, slot: string): Promise<string> {
    const value = this._powerupProperties.get(`${code}:${slot}`) ?? [];
    return value
      .map((item) =>
        typeof item === 'string'
          ? item
          : 'text' in item && typeof item.text === 'string'
            ? item.text
            : ''
      )
      .join('');
  }

  async getPowerupPropertyAsRem(code: string, slot: string): Promise<MockRem | undefined> {
    const value = this._powerupProperties.get(`${code}:${slot}`) ?? [];
    const reference = value.find(
      (item) => item && typeof item === 'object' && 'i' in item && item.i === 'q'
    ) as { _id?: string } | undefined;
    return reference?._id ? MockRem.registry.get(reference._id) : undefined;
  }

  async getPracticeDirection(): Promise<'forward' | 'backward' | 'both' | 'none'> {
    return this._practiceDirection;
  }

  async isPowerupProperty(): Promise<boolean> {
    return this._isPowerupProperty;
  }

  async isPowerupPropertyListItem(): Promise<boolean> {
    return this._isPowerupPropertyListItem;
  }

  async isPowerupSlot(): Promise<boolean> {
    return this._isPowerupSlot;
  }

  async isPowerupEnum(): Promise<boolean> {
    return this._isPowerupEnum;
  }

  /** Configure mock to behave as a property */
  setIsPropertyMock(val: boolean): void {
    this._isProperty = val;
  }

  async isProperty(): Promise<boolean> {
    return this._isProperty;
  }

  /** Set the mock property type */
  setPropertyTypeMock(type: string): void {
    this._propertyType = type;
  }

  async getPropertyType(): Promise<string | undefined> {
    return this._propertyType;
  }

  /** Set a property value for a specific property on this tagged rem */
  setTagPropertyValueMock(propertyId: string, value: RichTextInterface): void {
    this._tagPropertyValues.set(propertyId, value);
  }

  async getTagPropertyValue(propertyId: string): Promise<RichTextInterface> {
    return this._tagPropertyValues.get(propertyId) ?? [];
  }

  async setTagPropertyValue(
    propertyId: string,
    value: RichTextInterface | undefined
  ): Promise<void> {
    if (value === undefined) {
      this._tagPropertyValues.delete(propertyId);
      return;
    }

    this._tagPropertyValues.set(propertyId, value);
  }

  /** Configure mock to behave as a table */
  setIsTableMock(val: boolean): void {
    this._isTable = val;
  }

  async isTable(): Promise<boolean> {
    return this._isTable;
  }

  static registry = new Map<string, MockRem>();

  async addToPortal(portal: MockRem): Promise<void> {
    if (!portal._portalIncluded.includes(this)) portal._portalIncluded.push(this);
  }

  async removeFromPortal(portal: MockRem): Promise<void> {
    portal._portalIncluded = portal._portalIncluded.filter((item) => item !== this);
  }

  async getPortalDirectlyIncludedRem(): Promise<MockRem[]> {
    return this._portalIncluded;
  }

  async getPortalType(): Promise<number> {
    return 0;
  }

  async setIsProperty(isProperty: boolean): Promise<void> {
    this._isProperty = isProperty;
  }

  async setIsQuote(isQuote: boolean): Promise<void> {
    this._isQuote = isQuote;
  }

  async isQuote(): Promise<boolean> {
    return this._isQuote;
  }

  async setIsListItem(isListItem: boolean): Promise<void> {
    this._isListItem = isListItem;
  }

  async isListItem(): Promise<boolean> {
    return this._isListItem;
  }

  async setText(text: RichTextInterface): Promise<void> {
    this.text = text;
  }

  async setBackText(text: RichTextInterface): Promise<void> {
    this.backText = text;
  }

  async setType(type: SetRemType | RemType): Promise<void> {
    this.type = type as RemType;
  }

  async setParent(
    parent: PluginRem | MockRem | null,
    positionAmongstSiblings?: number
  ): Promise<void> {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }

    this.parent = parent as MockRem | null;

    if (this.parent) {
      const existingIndex = this.parent.children.indexOf(this);
      if (existingIndex !== -1) {
        this.parent.children.splice(existingIndex, 1);
      }
      const insertIndex = positionAmongstSiblings ?? this.parent.children.length;
      this.parent.children.splice(insertIndex, 0, this);
    }
  }

  async getChildrenRem(): Promise<MockRem[]> {
    return this.children;
  }

  async getParentRem(): Promise<MockRem | undefined> {
    return this.parent ?? undefined;
  }

  async addTag(tagId: string): Promise<void> {
    if (!this.tags.includes(tagId)) {
      this.tags.push(tagId);
    }
  }

  async removeTag(tagId: string): Promise<void> {
    this.tags = this.tags.filter((id) => id !== tagId);
  }

  async remove(): Promise<void> {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
    this.parent = null;
    this.children = [];
  }

  getTags(): string[] {
    return this.tags;
  }
}

/**
 * Chainable mock of the SDK RichTextBuilder (richText.text(...).rem(...).value()).
 */
export class MockRichTextBuilder {
  private parts: RichTextInterface = [];

  text(value: string): MockRichTextBuilder {
    this.parts.push(value);
    return this;
  }

  rem(rem: string | MockRem): MockRichTextBuilder {
    this.parts.push({
      i: 'q',
      _id: typeof rem === 'string' ? rem : rem._id,
    } as RichTextInterface[number]);
    return this;
  }

  async value(): Promise<RichTextInterface> {
    return this.parts;
  }
}

/**
 * Mock RemNote Plugin SDK
 */
export class MockRemNotePlugin {
  rootURL = 'https://example.test/plugin/';
  private rems = new Map<string, MockRem>();
  private remsByName = new Map<string, MockRem>();
  private nextId = 1;
  private eventListeners = new Map<
    string,
    Array<{ listenerKey: string | undefined; callback: (event: unknown) => void }>
  >();

  rem = {
    createRem: vi.fn(async (): Promise<MockRem> => {
      const id = `rem_${this.nextId++}`;
      const rem = new MockRem(id, '');
      this.rems.set(id, rem);
      return rem;
    }),

    createPortal: vi.fn(async (): Promise<MockRem> => {
      const id = `portal_${this.nextId++}`;
      const rem = new MockRem(id, '');
      rem.type = RemType.PORTAL;
      this.rems.set(id, rem);
      return rem;
    }),

    createTable: vi.fn(async (existingTag?: string | MockRem): Promise<MockRem> => {
      const id = `table_${this.nextId++}`;
      const rem = new MockRem(id, '');
      rem.setIsTableMock(true);
      this.rems.set(id, rem);
      if (existingTag) {
        const tag = typeof existingTag === 'string' ? this.rems.get(existingTag) : existingTag;
        if (tag) rem.text = tag.text;
      }
      return rem;
    }),

    createLinkRem: vi.fn(async (url: string): Promise<MockRem> => {
      const id = `link_${this.nextId++}`;
      const rem = new MockRem(id, url);
      this.rems.set(id, rem);
      return rem;
    }),

    findOne: vi.fn(async (id: string): Promise<MockRem | null> => {
      return this.rems.get(id) || null;
    }),

    findByName: vi.fn(async (names: string[], _parent: unknown): Promise<MockRem | null> => {
      const name = names[0];
      return this.remsByName.get(name) || null;
    }),

    createSingleRemWithMarkdown: vi.fn(
      async (markdown: string, parentId?: string): Promise<MockRem> => {
        const id = `rem_single_${this.nextId++}`;
        const richText = await this.richText.parseFromMarkdown(markdown);
        const rem = new MockRem(id, '');
        rem.text = richText;
        this.rems.set(id, rem);
        if (parentId) {
          const parentRem = this.rems.get(parentId);
          if (parentRem) await rem.setParent(parentRem as never);
        }
        return rem;
      }
    ),

    createTreeWithMarkdown: vi.fn(
      async (markdown: string, parentId?: string): Promise<MockRem[]> => {
        const allCreated: MockRem[] = [];

        // Parse each non-empty line into (indentLevel, text)
        const lines = markdown
          .split('\n')
          .map((line) => {
            const stripped = line.replace(/^(\s*)[-*]?\s*/, '');
            const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
            return { indent, text: stripped.trim() };
          })
          .filter((l) => l.text.length > 0);

        if (lines.length === 0) return [];

        // Normalize indents to levels (0, 1, 2, ...)
        const indentValues = [...new Set(lines.map((l) => l.indent))].sort((a, b) => a - b);
        const levelOf = (indent: number) => indentValues.indexOf(indent);

        // Stack tracks [rem, level] from root to current path
        const parentRem = parentId ? (this.rems.get(parentId) ?? null) : null;
        const stack: Array<{ rem: MockRem; level: number }> = [];

        for (const line of lines) {
          const level = levelOf(line.indent);
          const id = `rem_md_${this.nextId++}`;
          const rem = new MockRem(id, line.text);
          this.rems.set(id, rem);
          allCreated.push(rem);

          // Pop stack until we find the parent level
          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
          }

          if (stack.length === 0) {
            // Top-level: attach to supplied parentRem
            if (parentRem) {
              await rem.setParent(parentRem as never, (await parentRem.getChildrenRem()).length);
            }
          } else {
            const stackParent = stack[stack.length - 1].rem;
            await rem.setParent(stackParent as never, (await stackParent.getChildrenRem()).length);
          }

          stack.push({ rem, level });
        }

        return allCreated;
      }
    ),
  };

  richText = {
    rem: vi.fn((rem: string | MockRem) => new MockRichTextBuilder().rem(rem)),

    text: vi.fn((text: string) => new MockRichTextBuilder().text(text)),

    parseFromMarkdown: vi.fn(async (markdown: string): Promise<RichTextInterface> => {
      // Basic mock parsing for links: [text](url)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/;
      const match = markdown.match(linkRegex);
      if (match) {
        return [
          {
            i: 'm',
            text: match[1],
            url: match[2],
          },
        ];
      }
      return [markdown];
    }),

    replaceAllRichText: vi.fn(
      async (
        richText: RichTextInterface,
        findText: RichTextInterface,
        replacementText: RichTextInterface
      ): Promise<RichTextInterface> => {
        const placeholder = findText[0];
        if (typeof placeholder !== 'string' || placeholder.length === 0) {
          return richText;
        }

        const replaceInText = (
          text: string,
          buildTextElement: (part: string) => RichTextInterface[number]
        ): RichTextInterface => {
          const parts = text.split(placeholder);
          if (parts.length === 1) {
            return [buildTextElement(text)];
          }

          const result: RichTextInterface = [];
          for (const [index, part] of parts.entries()) {
            if (part) {
              result.push(buildTextElement(part));
            }
            if (index < parts.length - 1) {
              result.push(...replacementText);
            }
          }
          return result;
        };

        return richText.flatMap((element) => {
          if (typeof element === 'string') {
            return replaceInText(element, (part) => part);
          }

          if (
            element &&
            typeof element === 'object' &&
            'i' in element &&
            element.i === 'm' &&
            typeof element.text === 'string'
          ) {
            return replaceInText(element.text, (part) => ({ ...element, text: part }));
          }

          return [element];
        }) as RichTextInterface;
      }
    ),
  };

  search = {
    search: vi.fn(
      async (
        _query: RichTextInterface,
        _filter?: unknown,
        options?: { numResults?: number }
      ): Promise<MockRem[]> => {
        const limit = options?.numResults ?? 20;
        return Array.from(this.rems.values()).slice(0, limit);
      }
    ),
  };

  date = {
    getDailyDoc: vi.fn(async (_date: Date): Promise<MockRem> => {
      const id = 'daily_doc';
      let dailyDoc = this.rems.get(id);
      if (!dailyDoc) {
        dailyDoc = new MockRem(id, 'Daily Document');
        this.rems.set(id, dailyDoc);
      }
      return dailyDoc;
    }),
  };

  settings = {
    getSetting: vi.fn(async (id: string): Promise<unknown> => {
      return this.getSettingValue(id);
    }),

    setSetting: vi.fn(async (_id: string, _value: unknown): Promise<void> => {
      // Mock implementation
    }),

    registerBooleanSetting: vi.fn(async (): Promise<void> => {
      // Mock implementation
    }),

    registerStringSetting: vi.fn(async (): Promise<void> => {
      // Mock implementation
    }),
  };

  event = {
    addListener: vi.fn(
      (eventId: string, listenerKey: string | undefined, callback: (event: unknown) => void) => {
        const listeners = this.eventListeners.get(eventId) ?? [];
        listeners.push({ listenerKey, callback });
        this.eventListeners.set(eventId, listeners);
      }
    ),

    removeListener: vi.fn(
      (eventId: string, listenerKey: string | undefined, callback?: (event: unknown) => void) => {
        const listeners = this.eventListeners.get(eventId) ?? [];
        const filtered = listeners.filter((listener) => {
          if (listener.listenerKey !== listenerKey) {
            return true;
          }
          if (!callback) {
            return false;
          }
          return listener.callback !== callback;
        });
        this.eventListeners.set(eventId, filtered);
      }
    ),
  };

  messaging = {
    broadcast: vi.fn(async (message: unknown): Promise<void> => {
      this.emitEvent(MessagingEvents.MessageBroadcast, message);
    }),
  };

  storage = {
    setSession: vi.fn(async (key: string, value: unknown): Promise<void> => {
      this.sessionStorageStore.set(key, value);
      this.emitEvent('storage.session.changed', value, key);
    }),

    getSession: vi.fn(async <T = unknown>(key: string | undefined): Promise<T | undefined> => {
      if (!key) {
        return undefined;
      }
      return this.sessionStorageStore.get(key) as T | undefined;
    }),
  };

  app = {
    registerWidget: vi.fn(async (): Promise<void> => {
      // Mock implementation
    }),

    registerCommand: vi.fn(async (): Promise<void> => {
      // Mock implementation
    }),

    transaction: vi.fn(async <T>(fn: () => T | Promise<T>): Promise<Awaited<T>> => {
      return await fn();
    }),
  };

  // Helper methods
  private settingsStore = new Map<string, unknown>();
  private sessionStorageStore = new Map<string, unknown>();

  private getSettingValue(id: string): unknown {
    return this.settingsStore.get(id);
  }

  setTestSetting(id: string, value: unknown): void {
    this.settingsStore.set(id, value);
  }

  addTestRem(id: string, text: string, name?: string): MockRem {
    const rem = new MockRem(id, text);
    this.rems.set(id, rem);
    if (name) {
      this.remsByName.set(name, rem);
    }
    return rem;
  }

  clearTestData(): void {
    this.rems.clear();
    this.remsByName.clear();
    this.settingsStore.clear();
    this.sessionStorageStore.clear();
    this.eventListeners.clear();
    this.nextId = 1;
  }

  emitEvent(eventId: string, event: unknown, listenerKey?: string): void {
    const listeners = this.eventListeners.get(eventId) ?? [];
    listeners
      .filter((listener) => listenerKey === undefined || listener.listenerKey === listenerKey)
      .forEach((listener) => listener.callback(event));
  }

  getBroadcastMessages(): unknown[] {
    return this.messaging.broadcast.mock.calls.map(([message]) => message);
  }
}

/**
 * Helper to create mock MCP requests
 */
export function createMockRequest(
  action: string,
  payload: Record<string, unknown> = {}
): BridgeRequest {
  return {
    id: `req_${Date.now()}`,
    action,
    payload,
  };
}
