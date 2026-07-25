// Read-only diagnostic - does NOT modify the save.
//
//   node collect-stadium-samples.mjs "path\to\save"
//
// Collects (homeTeamName, raw Stadium binary string) for EVERY game in
// the save with a non-empty Stadium value - across all weeks, not just
// Bowl Week 1, since more data (and more repeats of the same team) is
// what makes the bit-split search actually work. Home team names are
// already confirmed decoding correctly, so those are trustworthy as
// the anchor for checking consistency.
import path from 'path';
import Franchise from 'madden-franchise';
import { TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node collect-stadium-samples.mjs <save-path>');
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
  if (!stadiumBin || /^0+$/.test(stadiumBin)) continue; // skip unset

  const homeRef = homeField.referenceData;
  if (!homeRef) continue;
  const homeTeamName = rowToName(homeRef.rowNumber);
  if (!homeTeamName) continue;

  results.push(`${homeTeamName}|${stadiumBin}`);
}

console.log(`Collected ${results.length} samples.\n`);
console.log(results.join('\n'));
