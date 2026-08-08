// Read-only diagnostic - does NOT modify the save.
//
//   node check-origid-match.mjs "path\to\save"
//
// Checks whether YEARBYYEARTEAMINDEX=100 matches North Texas's own
// TEAM_ORIGID (not row position), and separately reports whichever
// team (if any) actually has TEAM_ORIGID=100 or row=100.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS, resolveTable } from './playoffEditorCore.mjs';
import { rowToName, teamRow } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
await teamTable.readRecords();

const ntRow = teamRow('North Texas');
const ntRec = teamTable.records[ntRow];
let ntOrigId;
try { ntOrigId = ntRec['TEAM_ORIGID']; } catch (e) { ntOrigId = `<error: ${e.message}>`; }
console.log(`North Texas: row=${ntRow}, TEAM_ORIGID=${ntOrigId}`);
console.log(`Does TEAM_ORIGID match YEARBYYEARTEAMINDEX(100)? ${ntOrigId === 100 ? 'YES - MATCH' : 'no'}`);

console.log(`\nWhichever team is at row 100: ${rowToName(100)}`);

console.log(`\nSearching for any team whose TEAM_ORIGID === 100:`);
for (let i = 0; i < teamTable.records.length; i++) {
  const rec = teamTable.records[i];
  if (!rec) continue;
  let origId;
  try { origId = rec['TEAM_ORIGID']; } catch { continue; }
  if (origId === 100) {
    let name = '<unknown>';
    try { name = rowToName(i); } catch { /* leave as unknown */ }
    console.log(`  Row ${i}: TEAM_ORIGID=100, name=${name}`);
  }
}
