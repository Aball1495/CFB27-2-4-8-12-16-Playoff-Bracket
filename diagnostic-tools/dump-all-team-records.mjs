// Read-only diagnostic - does NOT modify the save.
//
//   node dump-all-team-records.mjs "path\to\save"
//
// Computes every team's W-L record using the exact same logic as the
// tool's own ranking engine (WINNER_BIT-based, week<=15 cutoff, same
// as bcsRankingFull.mjs's computeGameLogs) - prints a full list so it
// can be scanned against the in-game standings screen directly,
// rather than guessing which team to check first.
import path from 'path';
import { openSave, readMatchup, readRecordBits, TEAM_TABLE_ID, SEASON_WEEK_BIT, WINNER_BIT, normalizeSeasonWeek } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-all-team-records.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const records = new Map(); // teamName -> { wins, losses, games: [] }

for (let i = 0; i < recordCount; i++) {
  const m = readMatchup(buf, recordsStart, recordSize, i);
  if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;

  const recStart = recordsStart + i * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
  const week = normalizeSeasonWeek(rawWeek);
  if (week === null || week > 16) continue; // same cutoff as the real ranking engine (fixed: was >15, excluding Week 16 Conference Championship results that should count)

  const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
  let homeName, awayName;
  try { homeName = rowToName(m.home.row); } catch { continue; }
  try { awayName = rowToName(m.away.row); } catch { continue; }
  const winner = winnerBit === 0 ? homeName : awayName;
  const loser = winnerBit === 0 ? awayName : homeName;

  for (const [name, result] of [[winner, 'W'], [loser, 'L']]) {
    if (!records.has(name)) records.set(name, { wins: 0, losses: 0 });
    if (result === 'W') records.get(name).wins++;
    else records.get(name).losses++;
  }
}

const sorted = [...records.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`Computed records for ${sorted.length} teams (week <= 15 only, same as the real ranking engine):\n`);
for (const [name, rec] of sorted) {
  console.log(`${name}: ${rec.wins}-${rec.losses}`);
}
