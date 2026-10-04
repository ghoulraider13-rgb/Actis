// chokidar event-delivery probe: args [chokidarPath] [watchDir]
// Creates a new file at 500ms, appends to an existing file at 1200ms,
// prints the events chokidar actually delivered by 4000ms.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const chokidar = require(process.argv[2]);
const fs = require('fs');
const dir = process.argv[3];

const events = [];
const w = chokidar.watch(dir, { ignoreInitial: true, persistent: true, depth: 5, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } });
w.on('add', (p) => events.push('add:' + p.replace(dir + '/', '')));
w.on('change', (p) => events.push('change:' + p.replace(dir + '/', '')));
w.on('unlink', (p) => events.push('unlink:' + p.replace(dir + '/', '')));
w.on('error', (e) => events.push('error:' + e.message));

setTimeout(() => { fs.writeFileSync(dir + '/probe-new.txt', 'hello\n'); }, 500);
setTimeout(() => { try { fs.appendFileSync(dir + '/probe-existing.txt', 'more\n'); } catch (e) { events.push('append-failed:' + e.message); } }, 1200);
setTimeout(() => { try { fs.unlinkSync(dir + '/probe-new.txt'); events.push('did-unlink'); } catch (e) { events.push('unlink-failed:' + e.message); } }, 2000);

setTimeout(() => {
  console.log(JSON.stringify(events));
  w.close();
  process.exit(0);
}, 4000);
