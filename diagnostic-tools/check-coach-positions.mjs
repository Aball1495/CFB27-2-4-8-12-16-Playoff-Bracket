// Read-only diagnostic - does NOT modify the save.
//
//   node check-coach-positions.mjs "path\to\save" "Team Name"
//
// Dumps every coach whose TeamIndex matches the given team, along
// with their Position field - to find out what the real "Head Coach"
// enum value actually looks like, and confirm Kyle Flood vs Steve
// Sarkisian are really both attached to the same TeamIndex.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS, resolveTable } from './playoffEditorCore.mjs';
import { teamRow } from './teamLookup.mjs';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node check-coach-positions.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
await teamTable.readRecords();
const row = teamRow(teamName);
const teamRec = teamTable.records[row];
let teamIndexTarget;
try { teamIndexTarget = teamRec['TeamIndex']; } catch (e) { console.error('Could not read TeamIndex:', e.message); process.exit(1); }
console.log(`${teamName}: row=${row}, TeamIndex=${teamIndexTarget}\n`);

const coachTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Coach, 'Coach');
await coachTable.readRecords();

console.log(`Coaches with TeamIndex=${teamIndexTarget}:`);
for (let i = 0; i < coachTable.records.length; i++) {
  const rec = coachTable.records[i];
  if (!rec) continue;
  let teamIndex;
  try { teamIndex = rec['TeamIndex']; } catch { continue; }
  if (teamIndex !== teamIndexTarget) continue;

  let first = '', last = '', position = '<error>';
  try { first = rec['FirstName']; } catch { /* ignore */ }
  try { last = rec['LastName']; } catch { /* ignore */ }
  try { position = rec['Position']; } catch (e) { position = `<error: ${e.message}>`; }
  console.log(`  Row ${i}: ${first} ${last} - Position: ${position}`);
}
