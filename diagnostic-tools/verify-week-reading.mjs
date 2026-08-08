// Read-only diagnostic - does NOT modify the save.
//
//   node verify-week-reading.mjs "path\to\save" ["Team Name"]
//
// Computes every game's week BOTH ways - our existing raw-buffer math
// (SEASON_WEEK_BIT + mod-17 unwrap) and the schema-safe API
// (rec['SeasonWeek']) - side by side, flagging every disagreement.
// This measures the actual SCALE of the raw-buffer week-reading bug
// confirmed on Georgia's TCU bowl game, before rewriting the ranking
// engine around it. Optional team name filters output to just that
// team's games; omit it to scan everything.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, TEAM_TABLE_ID, SEASON_WEEK_BIT, normalizeSeasonWeek } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, teamFilter] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node verify-week-reading.mjs <save-path> ["<Team Name>"]');
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

let totalGames = 0, disagreements = 0;
const disagreementSamples = [];

for (let i = 0; i < recordCount; i++) {
  const m = readMatchup(buf, recordsStart, recordSize, i);
  if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;

  let homeName, awayName;
  try { homeName = rowToName(m.home.row); } catch { continue; }
  try { awayName = rowToName(m.away.row); } catch { continue; }

  if (teamFilter && homeName !== teamFilter && awayName !== teamFilter) continue;

  const recStart = recordsStart + i * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
  const rawBufferWeek = normalizeSeasonWeek(rawWeek);

  const rec = table.records[i];
  let schemaWeek, schemaWeekType;
  try { schemaWeek = rec['SeasonWeek']; } catch { schemaWeek = '<error>'; }
  try { schemaWeekType = rec['SeasonWeekType']; } catch { schemaWeekType = '<error>'; }

  totalGames++;
  if (rawBufferWeek !== schemaWeek) {
    disagreements++;
    if (disagreementSamples.length < 40) {
      disagreementSamples.push(`Record ${i}: ${awayName} @ ${homeName} - raw-buffer week=${rawBufferWeek} (raw bits ${rawWeek}), schema week=${schemaWeek} (${schemaWeekType})`);
    }
  }
}

console.log(`Total games checked: ${totalGames}`);
console.log(`Disagreements between raw-buffer and schema week reading: ${disagreements} (${totalGames > 0 ? ((disagreements/totalGames)*100).toFixed(1) : 0}%)\n`);
console.log('Sample disagreements:');
for (const s of disagreementSamples) console.log(`  ${s}`);
