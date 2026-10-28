// Live smoke test: does the watcher record events on a /mnt/c project when
// polling is on? Uses the built dist/. Drives real fs changes, then prints
// what landed in the ledger.
// Usage: ACTIS_HOME=<tmp> node scripts/smoke-wsl.mjs <projectRoot>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ActisWatcher } = require('../dist/watcher.js');
const { createProject, getProjectByPath, queryEvents, closeDb } = require('../dist/db.js');
const fs = require('fs');

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/smoke-wsl.mjs <projectRoot>');
  process.exit(1);
}

await createProject('smoke', root);
const watcher = new ActisWatcher({ projectRoot: root, debounceMs: 300 });
await watcher.initialize();
watcher.start();
await watcher.whenReady();
console.log('[smoke] watching (initial scan done)', root);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real changes on the target filesystem
fs.writeFileSync(root + '/smoke-new.txt', 'created on ' + new Date().toISOString() + '\n');
await sleep(1500);
fs.appendFileSync(root + '/smoke-existing.txt', 'appended line\n');
await sleep(1500);

// Stop flushing pending + persist, then report what the ledger holds.
await watcher.stop();
closeDb();

const project = await getProjectByPath(root);
const { events, total } = await queryEvents(project.id, {});
console.log('[smoke] total events:', total);
for (const e of events) {
  console.log(`  ${e.event_type.padEnd(7)} ${e.path}  size:${e.size_before ?? '-'}->${e.size_after ?? '-'}  diff:${e.diff ? 'yes' : 'none'}`);
}
process.exit(total >= 2 ? 0 : 2);
