// Read-only diagnostic - does NOT modify the save.
//
//   node dump-stadiums-correct-offset.mjs "path\to\save"
//
// CORRECTION: earlier diagnostics this session read byte offset 0 for
// "Stadium" (from the STADIUM_BYTE_OFFSET constant), but the actually-
// confirmed-working code (copyTeamStadiumIntoGame, proven in a real
// Apply log) reads/writes offset +4:
//   const targetOffset = recordsStart + seasonRecordIndex*recordSize + 4;
//   // confirmed: Stadium is byte 4, 4 bytes, on SeasonGame
// This redoes the conference-championship + native-CFP-slot + sample-
// regular-bowl check at the CORRECT offset.
import path from 'path';
import { openSave, readMatchup, TEAM_TABLE_ID, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-stadiums-correct-offset.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}
const tableIdsPresent = new Map(franchise.tables.map(t => [t.header.tableId, t.header.name]));

function printGame(recordIndex, label) {
  const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
  const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
  const recStart = recordsStart + recordIndex * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 4); // CORRECTED offset
  const decoded = decodeRef(stadiumWord);
  const tableName = tableIdsPresent.get(decoded.tableId);
  console.log(`${label} (record ${recordIndex}): ${awayName} @ ${homeName}  |  raw=${stadiumWord} (0x${stadiumWord.toString(16)})  ->  tableId=${decoded.tableId} row=${decoded.row}  [${tableName ? `table exists: "${tableName}"` : 'NO SUCH TABLE'}]`);
}

console.log('=== Raw SeasonWeek value distribution (sanity check for season drift) ===');
const weekCounts = new Map();
for (let i = 0; i < recordCount; i++) {
  let week;
  try { week = seasonGameTable.records[i]?.['SeasonWeek']; } catch { continue; }
  if (week === null || week === undefined) continue;
  weekCounts.set(week, (weekCounts.get(week) || 0) + 1);
}
[...weekCounts.entries()].sort((a, b) => a[0] - b[0]).forEach(([wk, count]) => console.log(`  week=${wk}: ${count} record(s)`));

console.log('\n=== Conference Championship games (dynamically finding the week with ~10 records, since week-number drift is unpredictable, not a fixed modulo) ===');
const candidateWeeks = [...weekCounts.entries()].filter(([, count]) => count >= 8 && count <= 12).map(([wk]) => wk);
console.log(`Candidate week(s) with 8-12 records: ${candidateWeeks.join(', ') || '(none found)'}\n`);
for (let i = 0; i < recordCount; i++) {
  let week;
  try { week = seasonGameTable.records[i]?.['SeasonWeek']; } catch { continue; }
  if (!candidateWeeks.includes(week)) continue;
  printGame(i, `ConfChamp (raw week ${week})`);
}

console.log('\n=== Native CFP slots ===');
[924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 401].forEach(r => {
  if (r < recordCount) printGame(r, `Native slot ${r}`);
});

console.log('\n=== Sample regular bowls (for comparison) ===');
[369, 386, 391, 395, 396, 400].forEach(r => { // Xbox, Liberty, Alamo, Gator, Sun, Texas
  if (r < recordCount) printGame(r, `Bowl record ${r}`);
});
