// Read-only diagnostic - does NOT modify the save.
//
//   node dump-all-team-records-v2.mjs "path\to\save"
//
// Rebuilt approach: uses SeasonWeekType (schema-safe, confirmed
// reliable) to decide whether a game counts, instead of any numeric
// week cutoff - SEASON_WEEK_BIT's raw-buffer reading is confirmed
// unreliable (100% disagreement with schema week in testing), so no
// numeric cutoff based on it can be trusted. Includes the game if
// SeasonWeekType === 'RegularSeason' (which also correctly covers the
// conference championship game), excludes anything bowl-related.
// WINNER_BIT stays exactly as before - confirmed correct via 10 real
// in-game results, completely unaffected by this issue.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, TEAM_TABLE_ID, WINNER_BIT } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-all-team-records-v2.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const matches = franchise.tables.filter(t => t.header.name === 'SeasonGame');
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await table.readRecords();

const records = new Map(); // teamName -> { wins, losses }

for (let i = 0; i < recordCount; i++) {
  const m = readMatchup(buf, recordsStart, recordSize, i);
  if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;

  const rec = table.records[i];
  let weekType;
  try { weekType = rec['SeasonWeekType']; } catch { continue; }
  if (weekType !== 'RegularSeason') continue; // the actual filter - no numeric week involved at all

  const recStart = recordsStart + i * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1); // unaffected, confirmed correct

  let homeName, awayName;
  try { homeName = rowToName(m.home.row); } catch { continue; }
  try { awayName = rowToName(m.away.row); } catch { continue; }
  const winner = winnerBit === 0 ? homeName : awayName;
  const loser = winnerBit === 0 ? awayName : homeName;

  for (const [name, result] of [[winner, 'W'], [loser, 'L']]) {
    if (!records.has(name)) records.set(name, { wins: 0, losses: 0 });
    if (result === 'W') records.get(name).wins++;
    else records.get(name).losses++;
  }
}

const sorted = [...records.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`Computed records for ${sorted.length} teams (SeasonWeekType === 'RegularSeason' only - no numeric week cutoff):\n`);
for (const [name, rec] of sorted) {
  console.log(`${name}: ${rec.wins}-${rec.losses}`);
}
