// Read-only diagnostic - does NOT modify the save.
//
//   node collect-stadium-samples-v2.mjs "path\to\save"
//
// Same as before, but also captures SeasonWeek and record index, so we
// can test whether Stadium correlates with WEEK rather than (or in
// addition to) team identity - a real alternate theory worth ruling
// in or out, not just re-testing the same team-only hypothesis.
import path from 'path';
import Franchise from 'madden-franchise';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node collect-stadium-samples-v2.mjs <save-path>');
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

const results = [];
for (let i = 0; i < seasonTable.records.length; i++) {
  const rec = seasonTable.records[i];
  if (!rec) continue;

  const homeField = getFieldObj(rec, 'HomeTeam');
  const stadiumField = getFieldObj(rec, 'Stadium');
  if (!homeField || !stadiumField) continue;

  const stadiumBin = stadiumField.value;
  if (!stadiumBin || /^0+$/.test(stadiumBin)) continue;

  const homeRef = homeField.referenceData;
  if (!homeRef) continue;
  const homeTeamName = rowToName(homeRef.rowNumber);
  if (!homeTeamName) continue;

  let week = null, year = null;
  try { week = rec['SeasonWeek']; } catch { /* ignore */ }
  try { year = rec['SeasonYear']; } catch { /* ignore */ }

  results.push(`${i}|${homeTeamName}|week${week}|year${year}|${stadiumBin}`);
}

console.log(`Collected ${results.length} samples.\n`);
console.log(results.join('\n'));
