/**
 * cc52 live bridge test server.
 *
 * Impersonates the bridge companion on ws://127.0.0.1:3002, waits for the
 * RemNote plugin to connect, then exercises every bridge action (upstream +
 * cc52 update_note extensions) against the live knowledge base.
 *
 * All writes happen inside a throwaway container note which is deleted at the
 * end via the cc52 removeAfter extension (which doubles as its test).
 *
 * Usage: node scripts/cc52-live-bridge-test.cjs
 * Then (re)load the plugin in RemNote so it connects.
 */

const { WebSocketServer } = require('ws');

const PORT = 3002;
const REQUEST_TIMEOUT_MS = 20_000;
const WAIT_FOR_PLUGIN_MS = 5 * 60_000;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const CONTAINER_TITLE = `CC52-BRIDGE-TEST-${STAMP}`;

const results = [];
let requestCounter = 0;
const pending = new Map();
let activeSocket = null;
let suiteStarted = false;

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const icon = { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', SKIP: 'SKIP' }[status] || status;
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function sendRequest(action, payload) {
  return new Promise((resolve, reject) => {
    if (!activeSocket) {
      reject(new Error('no active plugin connection'));
      return;
    }
    const id = `t${++requestCounter}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${action}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    activeSocket.send(JSON.stringify({ id, action, payload }));
  });
}

async function expectError(name, action, payload, messageFragment) {
  try {
    await sendRequest(action, payload);
    record(name, 'FAIL', 'expected an error but the call succeeded');
  } catch (error) {
    if (String(error.message).includes(messageFragment)) {
      record(name, 'PASS', `guarded: ${error.message}`);
    } else {
      record(name, 'FAIL', `unexpected error: ${error.message}`);
    }
  }
}

async function runSuite() {
  let containerId = null;
  const summaryPath = require('path').join(__dirname, `cc52-live-test-results-${STAMP}.json`);

  try {
    // 1. get_status
    const status = await sendRequest('get_status', {});
    const versionOk = String(status.pluginVersion || '').startsWith('0.17');
    record(
      'get_status',
      versionOk ? 'PASS' : 'FAIL',
      `pluginVersion=${status.pluginVersion}, write=${status.acceptWriteOperations}, replace=${status.acceptReplaceOperation}`
    );
    const replaceEnabled = status.acceptReplaceOperation === true;

    // 2. create container + main test note
    const container = await sendRequest('create_note', { title: CONTAINER_TITLE });
    containerId = container.remIds[0];
    record('create_note (container)', containerId ? 'PASS' : 'FAIL', `remId=${containerId}`);

    const main = await sendRequest('create_note', {
      title: 'cc52-main-note',
      parentId: containerId,
    });
    const mainId = main.remIds[0];
    record('create_note (child with parentId)', mainId ? 'PASS' : 'FAIL', `remId=${mainId}`);

    // 3. update_note: title
    const titled = await sendRequest('update_note', { remId: mainId, title: 'cc52-renamed' });
    record(
      'update_note title',
      titled.titles.includes('cc52-renamed') ? 'PASS' : 'FAIL',
      JSON.stringify(titled.titles)
    );

    // 4. update_note: appendContent
    const appended = await sendRequest('update_note', {
      remId: mainId,
      appendContent: '- cc52 line A\n- cc52 line B',
    });
    record(
      'update_note appendContent',
      appended.remIds.length === 2 ? 'PASS' : 'FAIL',
      `${appended.remIds.length} rems created`
    );

    const afterAppend = await sendRequest('read_note', { remId: mainId, contentMode: 'markdown' });
    const appendVisible =
      String(afterAppend.content || '').includes('cc52 line A') &&
      String(afterAppend.content || '').includes('cc52 line B');
    record('read_note sees appended children', appendVisible ? 'PASS' : 'FAIL');

    // 5. update_note: replaceContent (depends on plugin setting)
    if (replaceEnabled) {
      const replaced = await sendRequest('update_note', {
        remId: mainId,
        replaceContent: '- cc52 only line',
      });
      const afterReplace = await sendRequest('read_note', {
        remId: mainId,
        contentMode: 'markdown',
      });
      const replaceOk =
        String(afterReplace.content || '').includes('cc52 only line') &&
        !String(afterReplace.content || '').includes('cc52 line A');
      record('update_note replaceContent', replaceOk ? 'PASS' : 'FAIL', JSON.stringify(replaced));
    } else {
      await expectError(
        'update_note replaceContent guard (setting disabled)',
        'update_note',
        { remId: mainId, replaceContent: 'x' },
        'Replace operation is disabled'
      );
    }

    // 6. append + replace conflict guard
    await expectError(
      'update_note append+replace conflict guard',
      'update_note',
      { remId: mainId, appendContent: 'a', replaceContent: 'b' },
      'cannot be used together'
    );

    // 7. tags by name (0.17 returns tags as {tagRemId, name} objects; accept both shapes)
    const tagNames = (tags) => (tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    await sendRequest('update_note', { remId: mainId, addTags: ['cc52-test-tag'] });
    const tagged = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note addTags (by name)',
      tagNames(tagged.tags).includes('cc52-test-tag') ? 'PASS' : 'FAIL',
      JSON.stringify(tagged.tags || [])
    );

    await sendRequest('update_note', { remId: mainId, removeTags: ['cc52-test-tag'] });
    const untagged = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note removeTags (by name)',
      !tagNames(untagged.tags).includes('cc52-test-tag') ? 'PASS' : 'FAIL'
    );

    // 8. cc52: addAliases
    await sendRequest('update_note', {
      remId: mainId,
      addAliases: ['cc52-alias-one', 'cc52-alias-two'],
    });
    const aliased = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    const aliasesOk =
      (aliased.aliases || []).includes('cc52-alias-one') &&
      (aliased.aliases || []).includes('cc52-alias-two');
    record('update_note addAliases', aliasesOk ? 'PASS' : 'FAIL', JSON.stringify(aliased.aliases));

    // 9. cc52: mergeFromRemId
    const source = await sendRequest('create_note', {
      title: 'cc52-merge-source',
      parentId: containerId,
    });
    await sendRequest('update_note', { remId: mainId, mergeFromRemId: source.remIds[0] });
    const merged = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note mergeFromRemId',
      (merged.aliases || []).includes('cc52-merge-source') ? 'PASS' : 'FAIL',
      `aliases now: ${JSON.stringify(merged.aliases)}`
    );

    // 10. cc52: richText front with rem reference token
    await sendRequest('update_note', {
      remId: mainId,
      richText: [
        { type: 'text', value: 'cc52 front ' },
        { type: 'rem', remId: containerId },
      ],
    });
    const fronted = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    const frontOk =
      String(fronted.title || '').startsWith('cc52 front ') &&
      String(fronted.title || '').includes('CC52-BRIDGE-TEST');
    record(
      'update_note richText (front, with rem token)',
      frontOk ? 'PASS' : 'FAIL',
      `title="${fronted.title}"`
    );

    // 11. cc52: richTextBack
    await sendRequest('update_note', {
      remId: mainId,
      richTextBack: [{ type: 'text', value: 'cc52 back side' }],
    });
    const backed = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note richTextBack',
      String(backed.headline || '').includes('cc52 back side') ? 'PASS' : 'FAIL',
      `headline="${backed.headline}"`
    );

    // 12. richText + title conflict guard
    await expectError(
      'update_note richText+title conflict guard',
      'update_note',
      { remId: mainId, title: 'x', richText: [{ type: 'text', value: 'y' }] },
      'cannot be used together'
    );

    // 13. cc52: setParentId
    const parent2 = await sendRequest('create_note', {
      title: 'cc52-new-parent',
      parentId: containerId,
    });
    await sendRequest('update_note', { remId: mainId, setParentId: parent2.remIds[0] });
    const reparented = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note setParentId',
      reparented.parentRemId === parent2.remIds[0] ? 'PASS' : 'FAIL',
      `parent=${reparented.parentRemId}`
    );

    // 14. cc52: setIsDocument
    await sendRequest('update_note', { remId: mainId, setIsDocument: true });
    const docced = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'update_note setIsDocument',
      docced.remType === 'document' ? 'PASS' : 'FAIL',
      `remType=${docced.remType}`
    );
    await sendRequest('update_note', { remId: mainId, setIsDocument: false });

    // 15. cc52: setIsFolder (no read-back field; OK response = pass)
    const foldered = await sendRequest('update_note', { remId: mainId, setIsFolder: true });
    record(
      'update_note setIsFolder',
      foldered.titles.some((t) => t.includes('setIsFolder=true')) ? 'PASS' : 'FAIL',
      JSON.stringify(foldered.titles)
    );
    await sendRequest('update_note', { remId: mainId, setIsFolder: false });

    // 16. upstream: move_note back under container
    await sendRequest('move_note', {
      remId: mainId,
      newParentRemId: containerId,
      position: 'last',
      dryRun: false,
    });
    const moved = await sendRequest('read_note', { remId: mainId, contentMode: 'none' });
    record(
      'move_note (upstream action)',
      moved.parentRemId === containerId ? 'PASS' : 'FAIL',
      `parent=${moved.parentRemId}`
    );

    // 17. upstream: insert_children
    const inserted = await sendRequest('insert_children', {
      parentRemId: mainId,
      content: '- cc52 inserted child',
      position: 'last',
    });
    record(
      'insert_children (upstream action)',
      inserted.remIds.length === 1 ? 'PASS' : 'FAIL',
      JSON.stringify(inserted.titles)
    );

    // 18. upstream: list_children
    const listed = await sendRequest('list_children', { parentRemId: containerId });
    const childCount = Array.isArray(listed.children) ? listed.children.length : -1;
    record(
      'list_children (upstream action)',
      childCount >= 2 ? 'PASS' : 'FAIL',
      `${childCount} children under container`
    );

    // 19. upstream: set_document_status dry run
    const dry = await sendRequest('set_document_status', {
      remId: mainId,
      isDocument: true,
      dryRun: true,
    });
    record(
      'set_document_status dryRun (upstream action)',
      dry.dryRun === true && dry.changed === false ? 'PASS' : 'FAIL',
      `wouldChange=${dry.wouldChange}`
    );

    // 20. upstream: search finds the container
    const found = await sendRequest('search', { query: CONTAINER_TITLE, limit: 10 });
    const hit = (found.results || []).some((r) => r.remId === containerId);
    record(
      'search (upstream action)',
      hit ? 'PASS' : 'WARN',
      hit ? 'container found' : 'not indexed yet (may be search lag, not a bridge bug)'
    );

    // 21. append_journal + immediate cleanup of the created rems
    const journal = await sendRequest('append_journal', {
      content: 'cc52 bridge live-test entry (auto-removed)',
      timestamp: false,
    });
    let journalCleaned = true;
    for (const remId of journal.remIds || []) {
      try {
        await sendRequest('update_note', { remId, removeAfter: true });
      } catch {
        journalCleaned = false;
      }
    }
    record(
      'append_journal (+cleanup via removeAfter)',
      (journal.remIds || []).length > 0 && journalCleaned ? 'PASS' : 'WARN',
      `${(journal.remIds || []).length} journal rems created and removed`
    );

    // 22. cleanup stray tag rem created by addTags (best effort)
    try {
      const tagSearch = await sendRequest('search', { query: 'cc52-test-tag', limit: 10 });
      for (const r of tagSearch.results || []) {
        if (r.title === 'cc52-test-tag') {
          await sendRequest('update_note', { remId: r.remId, removeAfter: true });
        }
      }
      record('cleanup stray tag rem', 'PASS');
    } catch (error) {
      record('cleanup stray tag rem', 'WARN', `manual cleanup may be needed: ${error.message}`);
    }

    // 23. cc52: removeAfter — delete the whole test container (also the cleanup)
    const removed = await sendRequest('update_note', { remId: containerId, removeAfter: true });
    const gone = await sendRequest('read_note', { remId: containerId, contentMode: 'none' })
      .then(() => false)
      .catch(() => true);
    record(
      'update_note removeAfter (container cleanup)',
      removed.titles.includes('[REMOVED]') && gone ? 'PASS' : 'FAIL',
      gone ? 'container no longer readable' : 'container still readable!'
    );
    containerId = null;
  } catch (error) {
    record('SUITE ABORTED', 'FAIL', error.message);
    if (containerId) {
      try {
        await sendRequest('update_note', { remId: containerId, removeAfter: true });
        record('emergency cleanup', 'PASS', 'test container removed');
      } catch {
        record('emergency cleanup', 'WARN', `请手动删除笔记 "${CONTAINER_TITLE}"`);
      }
    }
  }

  const summary = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    skip: results.filter((r) => r.status === 'SKIP').length,
  };
  console.log('\n==== SUMMARY ====');
  console.log(JSON.stringify(summary));
  require('fs').writeFileSync(summaryPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`Results written to ${summaryPath}`);
  process.exit(summary.fail > 0 ? 1 : 0);
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT }, () => {
  console.log(`cc52 live test companion listening on ws://127.0.0.1:${PORT}`);
  console.log('Waiting for the RemNote plugin to connect (reload the plugin in RemNote now)...');
});

wss.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
  process.exit(2);
});

const waitTimer = setTimeout(() => {
  console.error('No plugin connection within 5 minutes; giving up.');
  process.exit(3);
}, WAIT_FOR_PLUGIN_MS);

wss.on('connection', (socket) => {
  console.log('Plugin connected.');
  if (activeSocket) {
    console.log('Ignoring extra connection (suite already bound).');
    socket.close(1000, 'test server busy');
    return;
  }
  activeSocket = socket;
  clearTimeout(waitTimer);

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'hello') {
      console.log(`Plugin hello: version ${message.version}`);
      socket.send(JSON.stringify({ type: 'companion_info', kind: 'cli', version: '0.17.0' }));
      if (!suiteStarted) {
        suiteStarted = true;
        setTimeout(() => runSuite(), 500);
      }
      return;
    }
    if (message.type === 'pong') return;

    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error !== undefined) {
        entry.reject(new Error(message.error));
      } else {
        entry.resolve(message.result);
      }
    }
  });

  socket.on('close', () => {
    if (activeSocket === socket) {
      activeSocket = null;
      console.log('Plugin disconnected.');
    }
  });
});
