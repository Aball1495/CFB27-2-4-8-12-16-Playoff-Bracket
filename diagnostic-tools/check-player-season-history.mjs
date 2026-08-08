// Read-only diagnostic - does NOT modify the save.
//
//   node check-player-season-history.mjs "path\to\save" "First" "Last"
//
// Player.SeasonStats[] holds each season's SEAS_YEAR, TeamPrefixName
// (cached string) and YEARBYYEARTEAMINDEX (plain int, not a reference
// type) directly on the player record itself. Comparing the cached
// string against what the index resolves to tells us directly whether
// this is the same row-drift issue as everything else, or something
// else entirely.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, firstName, lastName] = process.argv.slice(2);
if (!savePath || !firstName || !lastName) {
  console.error('Usage: node check-player-season-history.mjs <save-path> "<First>" "<Last>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const playerMatches = franchise.tables.filter(t => t.header.name === 'Player');
let targetRec = null, targetTable = null, targetIndex = null;
for (const t of playerMatches) {
  await t.readRecords();
  for (let i = 0; i < t.records.length; i++) {
    const rec = t.records[i];
    if (!rec) continue;
    let first, last;
    try { first = rec['FirstName'] ?? rec['firstName']; last = rec['LastName'] ?? rec['lastName']; } catch { continue; }
    if (first === firstName && last === lastName) {
      targetRec = rec; targetTable = t; targetIndex = i;
      break;
    }
  }
  if (targetRec) break;
}

if (!targetRec) {
  console.error(`Could not find ${firstName} ${lastName} in the Player table.`);
  process.exit(1);
}
console.log(`Found ${firstName} ${lastName} at record ${targetIndex}.\n`);

// Also grab their CURRENT team assignment for comparison, whatever
// field that actually is - trying the common candidates.
for (const key of ['TeamIndex', 'CurrentTeam', 'Team']) {
  try {
    const val = targetRec[key];
    console.log(`Player.${key} (current team, if this field is the right one): ${val}`);
  } catch { /* not this field name, try the next */ }
}
console.log('');

let seasonStats;
try {
  seasonStats = targetRec['SeasonStats'];
} catch (e) {
  console.error('Could not read SeasonStats field:', e.message);
  process.exit(1);
}
console.log('SeasonStats field type/shape:', Array.isArray(seasonStats) ? `Array, length ${seasonStats.length}` : typeof seasonStats);
console.log('');

if (Array.isArray(seasonStats)) {
  for (let i = 0; i < seasonStats.length; i++) {
    const entry = seasonStats[i];
    let year, teamPrefixName, yearByYearTeamIndex;
    try { year = entry['SEAS_YEAR']; } catch { year = '<error reading SEAS_YEAR>'; }
    try { teamPrefixName = entry['TeamPrefixName']; } catch { teamPrefixName = '<error>'; }
    try { yearByYearTeamIndex = entry['YEARBYYEARTEAMINDEX']; } catch { yearByYearTeamIndex = '<error>'; }

    let resolvedName = '<could not resolve>';
    try { resolvedName = rowToName(yearByYearTeamIndex); } catch { /* leave as could not resolve */ }

    const agree = resolvedName === teamPrefixName;
    console.log(`[${i}] year=${year}  TeamPrefixName="${teamPrefixName}"  YEARBYYEARTEAMINDEX=${yearByYearTeamIndex} -> resolves to "${resolvedName}"  ${agree ? 'AGREE' : '*** MISMATCH ***'}`);
  }
} else {
  console.log('SeasonStats did not come back as a plain array - raw value:', JSON.stringify(seasonStats));
}
