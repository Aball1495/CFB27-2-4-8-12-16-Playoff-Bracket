// Read-only diagnostic - does NOT modify the save.
//
//   node scan-bowlweek1-stadiums.mjs "path\to\save"
//
// For every Bowl Week 1 game (SeasonWeek 17), prints the raw Team and
// Stadium reference values directly - we don't yet know what shape
// madden-franchise returns for a reference-type field accessed this
// way (rec['FieldName']), so this just shows the real thing rather
// than guessing a property name on it.
import path from 'path';
import Franchise from 'madden-franchise';
import { TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node scan-bowlweek1-stadiums.mjs <save-path>');
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

console.log('Scanning Bowl Week 1 (SeasonWeek === 17)...\n');

let checked = 0;
for (let i = 0; i < seasonTable.records.length; i++) {
  const rec = seasonTable.records[i];
  if (!rec) continue;
  let week;
  try { week = rec['SeasonWeek']; } catch { continue; }
  if (week !== 17) continue;

  let homeRef = null, awayRef = null, stadiumRef = null;
  try { homeRef = rec['HomeTeam']; } catch { /* leave null */ }
  try { awayRef = rec['AwayTeam']; } catch { /* leave null */ }
  try { stadiumRef = rec['Stadium']; } catch { /* leave null */ }
  if (homeRef === null && awayRef === null) continue;

  checked++;
  console.log(`Record ${i}:`);
  console.log(`  HomeTeam raw value: ${JSON.stringify(homeRef)}`);
  console.log(`  AwayTeam raw value: ${JSON.stringify(awayRef)}`);
  console.log(`  Stadium raw value:  ${JSON.stringify(stadiumRef)}`);
  console.log('');
}

console.log(`Checked ${checked} Week 17 games.`);
console.log('Paste this whole thing back - once we see the real shape of these reference values, we can decode team names properly and compare each game\'s Stadium against its home team\'s own Stadium.');
