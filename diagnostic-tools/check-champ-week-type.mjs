// Read-only diagnostic - does NOT modify the save.
//
//   node check-champ-week-type.mjs "path\to\save"
//
// Checks SeasonWeekType specifically on the real week-16 conference
// championship games, to test whether findConferenceChampionsByStandings
// is silently excluding them via its "weekType !== 'RegularSeason' ->
// continue" filter - which would explain why its internal championship-
// week detection landed on week 13 instead of the real week 16.
import path from 'path';
import { openSave, resolveTable, TABLE_UNIQUE_IDS, readMatchup, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-champ-week-type.mjs <save-path>');
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

console.log('Every record with SeasonWeek == 16 - showing SeasonWeekType, matchup, and Stadium reference:\n');
for (let i = 0; i < recordCount; i++) {
  let week, weekType;
  try { week = seasonGameTable.records[i]?.['SeasonWeek']; weekType = seasonGameTable.records[i]?.['SeasonWeekType']; } catch { continue; }
  if (week !== 16) continue;

  const m = readMatchup(buf, recordsStart, recordSize, i);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : `<non-FBS>`;
  const awayName = awayIsFbs ? rowToName(m.away.row) : `<non-FBS>`;
  const recStart = recordsStart + i * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 0);

  console.log(`Record ${i}: SeasonWeekType="${weekType}"  ${awayName} @ ${homeName}  |  Stadium raw word: ${stadiumWord} (0x${stadiumWord.toString(16)})`);
}
