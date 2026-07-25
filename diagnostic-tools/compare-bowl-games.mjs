// Read-only diagnostic - does NOT modify either save.
//
//   node compare-bowl-games.mjs "path\to\DYNASTY-VANILLA" "path\to\DYNASTY-SAVEFP"
//
// Finds SeasonGame records in the AFFECTED save whose matchup (by team
// names) also appears in the UNAFFECTED save, and dumps every field on
// both records side-by-side - whatever field actually differs (the
// bowl name/label, most likely) should just be obvious from the diff,
// rather than us guessing at a field name ahead of time.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [vanillaPath, affectedPath] = process.argv.slice(2);
if (!vanillaPath || !affectedPath) {
  console.error('Usage: node compare-bowl-games.mjs <unaffected-save> <affected-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

async function loadSeasonGames(savePath) {
  const { unpackedFileContents, recordsStart, recordSize } = await openSave(savePath, schemaDirectory);
  const buf = Buffer.from(unpackedFileContents);
  const franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });
  const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
  const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  await table.readRecords();

  const games = [];
  for (let i = 0; i < table.records.length; i++) {
    const rec = table.records[i];
    if (!rec) continue;
    let m;
    try { m = readMatchup(buf, recordsStart, recordSize, i); } catch { continue; }
    if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;
    const home = rowToName(m.home.row);
    const away = rowToName(m.away.row);
    games.push({ index: i, home, away, record: rec });
  }
  return { games, table };
}

function dumpFields(rec) {
  const out = {};
  const candidateFields = [
    'GameStatus', 'IsSimmed', 'HasBeenPublished', 'SeasonYear', 'SeasonWeek',
    'BowlName', 'BowlGameName', 'BowlSubType', 'BowlGameTitle', 'GameTitle',
    'ScheduleName', 'DisplayName', 'Title', 'Name', 'BowlType', 'GameType',
  ];
  for (const f of candidateFields) {
    try { out[f] = rec[f]; } catch { /* field doesn't exist on this schema, skip silently */ }
  }
  return out;
}

console.log('Loading unaffected save...');
const vanilla = await loadSeasonGames(vanillaPath);
console.log('Loading affected save...');
const affected = await loadSeasonGames(affectedPath);

console.log(`\nUnaffected save: ${vanilla.games.length} real games found.`);
console.log(`Affected save: ${affected.games.length} real games found.\n`);

let comparedCount = 0;
for (const ag of affected.games) {
  const match = vanilla.games.find(vg =>
    (vg.home === ag.home && vg.away === ag.away) || (vg.home === ag.away && vg.away === ag.home)
  );
  if (!match) continue;
  comparedCount++;
  console.log(`=== ${ag.home} vs ${ag.away} (unaffected record ${match.index}, affected record ${ag.index}) ===`);
  const vFields = dumpFields(match.record);
  const aFields = dumpFields(ag.record);
  const allKeys = new Set([...Object.keys(vFields), ...Object.keys(aFields)]);
  for (const key of allKeys) {
    const vVal = vFields[key];
    const aVal = aFields[key];
    const differs = JSON.stringify(vVal) !== JSON.stringify(aVal);
    console.log(`  ${key}: unaffected=${vVal}  |  affected=${aVal}  ${differs ? '  <-- DIFFERS' : ''}`);
  }
  console.log('');
}
console.log(`Compared ${comparedCount} matching games across both saves.`);
if (comparedCount === 0) {
  console.log('No matching team-pairs found between the two saves - they may be different dynasties/seasons entirely, not the same one before/after MMC. Field names guessed above may also just be wrong for this schema - if every "DIFFERS" list comes back empty even for known-different games, that confirms it.');
}
