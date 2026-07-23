// Read-only diagnostic - does NOT modify the save file at all.
// Run from your project folder (needs node_modules, schemas/, and
// main.cjs/playoffEditorCore.mjs/teamLookup.mjs already present there):
//
//   node check-championship.mjs "C:\path\to\your\current\save"
//
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, WINNER_BIT, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: node check-championship.mjs <path-to-save-file>');
  process.exit(1);
}

const schemaDirectory = path.join(process.cwd(), 'schemas');

// Same raw-buffer read our tool already uses for every other game.
const { unpackedFileContents, recordsStart, recordSize } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);
const m = readMatchup(buf, recordsStart, recordSize, 401);
console.log('Raw home field ->', m.home.tableId === TEAM_TABLE_ID ? rowToName(m.home.row) : '(not a team)');
console.log('Raw away field ->', m.away.tableId === TEAM_TABLE_ID ? rowToName(m.away.row) : '(not a team)');

const recStart = recordsStart + 401 * recordSize;
const recordBuf = buf.subarray(recStart, recStart + recordSize);
const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
console.log('Raw WINNER_BIT value ->', winnerBit, '(0 = home field won, 1 = away field won, per how every other round already reads this)');

// Cross-check against the schema's own named GameStatus field and any
// score fields it exposes, via madden-franchise directly - independent
// of whether our own bit-offset reading above is right.
const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const SEASON_GAME_UNIQUE_ID = 4049338978;
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();
const rec = seasonTable.records[401];

console.log('\nSchema-named GameStatus ->', (() => { try { return rec['GameStatus']; } catch (e) { return 'ERROR: ' + e.message; } })());
for (const fieldName of ['HomeScore', 'AwayScore', 'HomeTeamScore', 'AwayTeamScore']) {
  try { console.log(`Schema-named ${fieldName} ->`, rec[fieldName]); } catch { /* field may not exist under this name, skip silently */ }
}

console.log('\nKnown real result for comparison: Notre Dame 31, Ohio State 29, Notre Dame won.');
