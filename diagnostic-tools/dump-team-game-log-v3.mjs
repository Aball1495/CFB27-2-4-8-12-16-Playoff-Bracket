// Read-only diagnostic - does NOT modify the save.
//
//   node dump-team-game-log-v3.mjs "path\to\save" "Team Name"
//
// Rebuilt for the current (486.1 schema, SeasonWeekType-based) logic in
// bcsRankingFull.mjs, including the FBS/non-FBS opponent fix. Prints
// EVERY SeasonGame record touching the named team - including games
// against non-FBS (FCS) opponents that the old diagnostic silently
// dropped - so you can see exactly what the tool is counting and why.
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, readMatchup, readRecordBits, SEASON_WEEK_BIT, WINNER_BIT, normalizeSeasonWeek, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName, teamRow } from './teamLookup.mjs';

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node dump-team-game-log-v3.mjs <save-path> "<Team Name>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();
const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
await teamTable.readRecords();

// Current TEAM_TABLE_ID, resolved at runtime by openSave/playoffEditorCore
// internals - re-derive it the same way readMatchup's decodeRef expects,
// by checking a known-good record. Simplest reliable way from outside the
// module: read it off any Team-table matchup we already trust, OR just
// compare tableId against the Team table's own tableId directly.
const TEAM_TABLE_ID = teamTable.header.tableId;

const myRow = teamRow(teamName);

console.log(`=== Full game log for ${teamName} (row ${myRow}, TEAM_TABLE_ID=${TEAM_TABLE_ID}) ===\n`);

let shown = 0;
let countedWins = 0, countedLosses = 0;
for (let i = 0; i < recordCount; i++) {
  const m = readMatchup(buf, recordsStart, recordSize, i);
  const homeIsMe = m.home.tableId === TEAM_TABLE_ID && m.home.row === myRow;
  const awayIsMe = m.away.tableId === TEAM_TABLE_ID && m.away.row === myRow;
  if (!homeIsMe && !awayIsMe) continue;

  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : `<non-FBS tableId=${m.home.tableId} row=${m.home.row}>`;
  const awayName = awayIsFbs ? rowToName(m.away.row) : `<non-FBS tableId=${m.away.tableId} row=${m.away.row}>`;

  let weekType = '<threw>';
  try { weekType = seasonGameTable.records[i]?.['SeasonWeekType']; } catch { /* leave as <threw> */ }

  const recStart = recordsStart + i * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
  const week = normalizeSeasonWeek(rawWeek);
  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
  const homeWon = winnerBit === 0;
  const myResult = homeIsMe ? (homeWon ? 'WIN' : 'LOSS') : (homeWon ? 'LOSS' : 'WIN');

  const countedByCurrentLogic = weekType === 'RegularSeason';
  if (countedByCurrentLogic) { if (myResult === 'WIN') countedWins++; else countedLosses++; }
  shown++;

  console.log(
    `Record ${i}: week=${week} (raw ${rawWeek})  weekType=${weekType}  ` +
    `${awayName} @ ${homeName}  ->  ${myResult}  ` +
    `[home tableId=${m.home.tableId}, away tableId=${m.away.tableId}]  ` +
    `${countedByCurrentLogic ? '' : '<-- NOT counted (weekType !== RegularSeason)'}`
  );
}

console.log(`\n${shown} total game(s) found touching ${teamName}.`);
console.log(`Tool's current computed record (RegularSeason-only, FBS+non-FBS opponents both counted for ${teamName}'s own result): ${countedWins}-${countedLosses}`);
