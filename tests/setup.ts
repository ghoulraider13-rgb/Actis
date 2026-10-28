// Shared test harness: each test gets a throwaway ACTIS_HOME so the ledger
// never touches the real ~/.actis and tests never see each other's data.
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeDb } from '../src/db.js';

export async function resetLedger(): Promise<void> {
  // Close any cached db first so the next getDb() re-reads ACTIS_HOME.
  closeDb();
  process.env.ACTIS_HOME = mkdtempSync(join(tmpdir(), 'actis-test-'));
}
