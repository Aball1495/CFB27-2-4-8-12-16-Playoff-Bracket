// Read-only diagnostic - does NOT modify the save.
//
//   node check-team-index-order.mjs "path\to\save"
//
// Team.TEAM_ORDER and Team.TeamIndex are real, separate fields
// directly on the Team record (confirmed via schema) - checking North
// Texas's actual values against the reported 76/62, and critically,
// searching for whichever team has TeamIndex=100, which is the
// mystery value from Tayven Jackson's season stat record.
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
let ntOrder, ntIndex;
try { ntOrder = ntRec['TEAM_ORDER']; } catch (e) { ntOrder = `<error: ${e.message}>`; }
try { ntIndex = ntRec['TeamIndex']; } catch (e) { ntIndex = `<error: ${e.message}>`; }
console.log(`North Texas (row ${ntRow}): TEAM_ORDER=${ntOrder}, TeamIndex=${ntIndex}`);
console.log(`Matches reported values (order=76, index=62)? order: ${ntOrder === 76 ? 'YES' : 'no'}, index: ${ntIndex === 62 ? 'YES' : 'no'}`);

console.log(`\nSearching for any team whose TeamIndex === 100 (the mystery value from the season stat record):`);
let anyMatch = false;
for (let i = 0; i < teamTable.records.length; i++) {
  const rec = teamTable.records[i];
  if (!rec) continue;
  let idx;
  try { idx = rec['TeamIndex']; } catch { continue; }
  if (idx === 100) {
    anyMatch = true;
    let name = '<unknown>';
    try { name = rowToName(i); } catch { /* leave as unknown */ }
    console.log(`  Row ${i}: TeamIndex=100, name=${name}`);
  }
}
if (!anyMatch) console.log('  No team found with TeamIndex=100.');

console.log(`\nSearching for any team whose TEAM_ORDER === 100:`);
let anyOrderMatch = false;
for (let i = 0; i < teamTable.records.length; i++) {
  const rec = teamTable.records[i];
  if (!rec) continue;
  let ord;
  try { ord = rec['TEAM_ORDER']; } catch { continue; }
  if (ord === 100) {
    anyOrderMatch = true;
    let name = '<unknown>';
    try { name = rowToName(i); } catch { /* leave as unknown */ }
    console.log(`  Row ${i}: TEAM_ORDER=100, name=${name}`);
  }
}
if (!anyOrderMatch) console.log('  No team found with TEAM_ORDER=100.');
