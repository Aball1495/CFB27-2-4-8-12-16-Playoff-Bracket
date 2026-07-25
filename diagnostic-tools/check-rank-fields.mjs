// Read-only diagnostic - does NOT modify the save.
//
//   node check-rank-fields.mjs "path\to\save" "Team Name"
//
// Dumps all 4 rank-related fields the tool's sync writes to
// (CFPPoll/CoachesPoll/MediaPoll CurrentRank + TeamRank), to find which
// one still shows the wrong value - LSU confirmed showing 11 on one
// in-game UI element and 12 on another, meaning they read different
// fields and our sync likely missed one of them.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node check-rank-fields.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await teamTable.readRecords();

let teamRow = null;
for (let i = 0; i < teamTable.records.length; i++) {
  let name;
  try { name = rowToName(i); } catch { continue; }
  if (name === teamName) { teamRow = i; break; }
}
if (teamRow === null) { console.error(`${teamName} not found`); process.exit(1); }

const rec = teamTable.records[teamRow];
console.log(`${teamName} (Team row ${teamRow}):`);
for (const field of ['CFPPoll_CurrentRank', 'CFPPoll_LastWeeksRank', 'CoachesPoll_CurrentRank', 'CoachesPoll_LastWeeksRank', 'MediaPoll_CurrentRank', 'MediaPoll_LastWeeksRank', 'TeamRank']) {
  let val;
  try { val = rec[field]; } catch (e) { val = `<error: ${e.message}>`; }
  console.log(`  ${field}: ${val}`);
}
