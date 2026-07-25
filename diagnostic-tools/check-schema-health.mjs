// Read-only diagnostic - does NOT modify the save file. Run from your
// project folder against a save from the UPDATED game version:
//
//   node check-schema-health.mjs "path\to\a\post-update\save"
//
// What this checks, and why each one matters:
//
// 1. Does the SeasonGame table still resolve by its unique ID, and is
//    its record count in a sane range? If the update changed table
//    IDs or restructured the table, this either throws or comes back
//    with a wildly different recordCapacity than expected.
// 2. Can we read a real, known-played game's teams via readMatchup
//    and get back actual team names (not garbage/undefined)? This is
//    the thing that would silently break if TEAM_TABLE_ID resolution
//    or the byte offsets inside readMatchup shifted.
// 3. Do the specific named schema fields we rely on (GameStatus,
//    HasBeenPublished, IsSimmed, SeasonYear) still exist and return
//    sensible-looking values, not throw or come back undefined?
// 4. Does WINNER_BIT still agree with GameStatus/HasBeenPublished in
//    the direction we expect, on a game we can reason about?
// 5. What schema version does madden-franchise itself report finding
//    inside the save, versus the 472.0 we've hardcoded everywhere?
//
// None of this proves nothing changed - it just surfaces the specific
// things that would silently produce wrong answers if something did.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, WINNER_BIT, TEAM_TABLE_ID, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: node check-schema-health.mjs <path-to-save-file>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

console.log('=== 1. Opening the save and resolving SeasonGame ===');
let buf, recordsStart, recordSize, seasonTable, franchise;
try {
  const opened = await openSave(savePath, schemaDirectory);
  buf = Buffer.from(opened.unpackedFileContents);
  recordsStart = opened.recordsStart;
  recordSize = opened.recordSize;
  console.log('openSave() succeeded. recordsStart =', recordsStart, ' recordSize =', recordSize);
} catch (e) {
  console.log('FAILED at openSave():', e.message);
  console.log('This is the earliest possible failure point - if this throws, nothing else below matters.');
  process.exit(1);
}

try {
  franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  console.log('Franchise.create() succeeded with schemaOverride 472.0.');
  console.log('Schema major/minor/gameYear franchise actually detected in the save:', franchise.schema?.meta ?? '(not exposed the way we expected - check manually)');
} catch (e) {
  console.log('FAILED at Franchise.create():', e.message);
  process.exit(1);
}

const SEASON_GAME_UNIQUE_ID = 4049338978;
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
console.log('Tables matching SEASON_GAME_UNIQUE_ID:', matches.length);
if (matches.length === 0) {
  console.log('!!! ZERO MATCHES - the unique ID itself no longer resolves to anything. This is a real break.');
  process.exit(1);
}
seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();
console.log('Resolved SeasonGame table. recordCapacity =', seasonTable.header.recordCapacity, '(expected in the low thousands - flag if this looks wildly different from past saves)');

console.log('\n=== 2. Reading a real regular-season game (record 0) ===');
try {
  const m = readMatchup(buf, recordsStart, recordSize, 0);
  const home = m.home.tableId === TEAM_TABLE_ID ? rowToName(m.home.row) : `(tableId ${m.home.tableId}, expected ${TEAM_TABLE_ID})`;
  const away = m.away.tableId === TEAM_TABLE_ID ? rowToName(m.away.row) : `(tableId ${m.away.tableId}, expected ${TEAM_TABLE_ID})`;
  console.log('Record 0: home =', home, ' away =', away);
  console.log(home.startsWith('(') || away.startsWith('(') ? '!!! One or both came back as an unresolved tableId, not a team name - TEAM_TABLE_ID or the byte offsets may have shifted.' : 'Looks like real team names - good sign.');
} catch (e) {
  console.log('FAILED reading record 0:', e.message);
}

console.log('\n=== 3. Named schema fields on record 0 ===');
for (const field of ['GameStatus', 'HasBeenPublished', 'IsSimmed', 'SeasonYear', 'SeasonWeek']) {
  try {
    const val = seasonTable.records[0][field];
    console.log(`${field}: ${val}  ${val === undefined ? '!!! undefined - field name may have changed' : ''}`);
  } catch (e) {
    console.log(`${field}: THREW ERROR - ${e.message}`);
  }
}

console.log('\n=== 4. WINNER_BIT vs the fields above, on record 0 ===');
try {
  const recStart = recordsStart + 0 * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
  console.log('WINNER_BIT =', winnerBit, '(0 = home field won, 1 = away field won)');
  console.log('Compare this by eye against the real result of this specific game in-game, same way we confirmed the championship earlier.');
} catch (e) {
  console.log('FAILED reading WINNER_BIT:', e.message);
}

console.log('\n=== Summary ===');
console.log('Anything marked with "!!!" above is a real red flag worth investigating before trusting the tool on this save.');
console.log('If everything above looks clean, that\'s a good sign - though it only checks the specific things this tool touches, not the whole schema.');
