// Read-only diagnostic - does NOT modify the save.
//
//   node read-seasonstats-entry.mjs "path\to\save"
//
// Reads the actual standalone "SeasonStats[]" table (tableId 6349,
// confirmed via Player.SeasonStats's own referenceData) at row 5181
// and a few rows around it, checking whether TeamPrefixName (cached
// string) agrees with what YEARBYYEARTEAMINDEX resolves to.
import path from 'path';
import Franchise from 'madden-franchise';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node read-seasonstats-entry.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const table = franchise.tables.find(t => t.header.tableId === 6349);
if (!table) { console.error('Could not find table with tableId 6349.'); process.exit(1); }
console.log(`Table found: name="${table.header.name}", recordCapacity=${table.header.recordCapacity}, uniqueId=${table.header.uniqueId}`);
await table.readRecords();

for (const row of [5180, 5181, 5182, 5183]) {
  const rec = table.records[row];
  if (!rec) { console.log(`Row ${row}: no record`); continue; }
  let year, teamPrefixName, yearByYearTeamIndex, gamesPlayed;
  try { year = rec['SEAS_YEAR']; } catch { year = '<error>'; }
  try { teamPrefixName = rec['TeamPrefixName']; } catch { teamPrefixName = '<error>'; }
  try { yearByYearTeamIndex = rec['YEARBYYEARTEAMINDEX']; } catch { yearByYearTeamIndex = '<error>'; }
  try { gamesPlayed = rec['GAMESPLAYED']; } catch { gamesPlayed = '<error>'; }

  let resolvedName = '<could not resolve>';
  try { resolvedName = rowToName(yearByYearTeamIndex); } catch { /* leave as-is */ }
  const agree = resolvedName === teamPrefixName;

  console.log(`Row ${row}: year=${year}, gamesPlayed=${gamesPlayed}, TeamPrefixName="${teamPrefixName}", YEARBYYEARTEAMINDEX=${yearByYearTeamIndex} -> resolves to "${resolvedName}"  ${agree ? 'AGREE' : '*** MISMATCH ***'}`);
}
