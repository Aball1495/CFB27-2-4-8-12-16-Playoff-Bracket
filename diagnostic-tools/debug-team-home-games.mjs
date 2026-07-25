// Read-only diagnostic - does NOT modify the save.
//
//   node debug-team-home-games.mjs "path\to\save" "Team Name"
//
// Finds EVERY record where the given team is HomeTeam, regardless of
// week, and prints the actual SeasonWeek/SeasonWeekType values - to
// find out whether the week filter itself is broken, or whether team
// name matching is the actual problem.
import path from 'path';
import Franchise from 'madden-franchise';
import { rowToName } from './teamLookup.mjs';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node debug-team-home-games.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}
function teamNameOf(rec, key) {
  const f = getFieldObj(rec, key);
  if (!f) return null;
  const ref = f.referenceData;
  if (!ref) return null;
  return rowToName(ref.rowNumber);
}

let found = 0;
for (let i = 0; i < seasonTable.records.length; i++) {
  const rec = seasonTable.records[i];
  if (!rec) continue;
  const home = teamNameOf(rec, 'HomeTeam');
  if (home !== teamName) continue;

  found++;
  let week = '<threw>', weekType = '<threw>', year = '<threw>';
  try { week = rec['SeasonWeek']; } catch { /* leave as <threw> */ }
  try { weekType = rec['SeasonWeekType']; } catch { /* leave as <threw> */ }
  try { year = rec['SeasonYear']; } catch { /* leave as <threw> */ }
  const stadiumField = getFieldObj(rec, 'Stadium');
  const hasStadium = stadiumField && stadiumField.value && !/^0+$/.test(stadiumField.value);
  const away = teamNameOf(rec, 'AwayTeam');

  console.log(`Record ${i}: ${away} @ ${home}  |  SeasonWeek=${week}  SeasonWeekType=${weekType}  SeasonYear=${year}  hasStadium=${hasStadium}`);
}
console.log(`\nTotal home games found for "${teamName}": ${found}`);
