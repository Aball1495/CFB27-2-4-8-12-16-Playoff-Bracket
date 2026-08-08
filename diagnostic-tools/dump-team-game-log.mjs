// Read-only diagnostic - does NOT modify the save.
//
//   node dump-team-game-log.mjs "path\to\save" "Team Name"
//
// Reproduces bcsRankingFull.mjs's computeGameLogs() logic exactly, but
// prints every game for one team instead of just aggregating win%.
// Compare this against the real in-game schedule/results screen to
// find exactly which game disagrees, rather than guessing.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, TEAM_TABLE_ID, SEASON_WEEK_BIT, WINNER_BIT, normalizeSeasonWeek, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node dump-team-game-log.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

// Schema-aware table too, just for reading SeasonYear by field name -
// same pattern as every other diagnostic this session.
const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const seasonMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.SeasonGame);
const franchiseSeasonTable = seasonMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await franchiseSeasonTable.readRecords();

const games = [];
for (let i = 0; i < recordCount; i++) {
  const m = readMatchup(buf, recordsStart, recordSize, i);
  if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;
  const recStart = recordsStart + i * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
  const week = normalizeSeasonWeek(rawWeek);
  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
  const homeName = rowToName(m.home.row);
  const awayName = rowToName(m.away.row);
  if (homeName !== teamName && awayName !== teamName) continue;

  let seasonYear = '<threw>';
  try {
    // Reuse the same schema-aware access pattern as everywhere else,
    // rather than guessing a raw bit offset for this specific field.
    seasonYear = franchiseSeasonTable.records[i]['SeasonYear'];
  } catch { /* leave as <threw> */ }

  const includedInRankings = week !== null && week <= 16;
  games.push({
    record: i, week, rawWeek, homeName, awayName, seasonYear,
    winner: winnerBit === 0 ? homeName : awayName,
    includedInRankings,
  });
}
games.sort((a, b) => (a.week ?? 999) - (b.week ?? 999));

console.log(`=== Full game log for ${teamName} (${games.length} games found) ===\n`);
for (const g of games) {
  const result = g.winner === teamName ? 'WIN' : 'LOSS';
  console.log(`Record ${g.record}: week=${g.week} (raw ${g.rawWeek})  SeasonYear=${g.seasonYear}  ${g.awayName} @ ${g.homeName}  ->  ${result} (winner: ${g.winner})  ${g.includedInRankings ? '' : '<-- EXCLUDED from rankings/standings (week > 16 or null)'}`);
}

const includedGames = games.filter(g => g.includedInRankings);
const wins = includedGames.filter(g => g.winner === teamName).length;
const losses = includedGames.length - wins;
console.log(`\nTool's computed record (games actually used for rankings/standings): ${wins}-${losses}`);
