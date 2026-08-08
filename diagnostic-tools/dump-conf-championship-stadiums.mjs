// Read-only diagnostic - does NOT modify the save.
//
//   node dump-conf-championship-stadiums.mjs "path\to\save"
//
// Finds every Conference Championship game via the project's existing,
// already-correct findConferenceChampionshipGames helper, and prints its
// two teams plus its raw Stadium reference. Real-world conference title
// games are neutral-site (SEC at Mercedes-Benz, Big Ten at Lucas Oil,
// ACC at Bank of America, Big 12 at AT&T, MAC at Ford Field) - if this
// game models the same fixed sites, these references are a legitimate,
// already-correct source we can copy from, same pattern as
// copyTeamStadiumIntoGame already uses for team home stadiums.
import path from 'path';
import { openSave, findConferenceChampionshipGames, resolveTable, TABLE_UNIQUE_IDS, readMatchup } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-conf-championship-stadiums.mjs <save-path>');
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

const games = findConferenceChampionshipGames(buf, recordsStart, recordSize, recordCount, seasonGameTable);
console.log(`Found ${games.length} Conference Championship game(s) via the filtered helper (currently hardcoded to SeasonWeek===15):\n`);

for (const g of games) {
  const homeName = rowToName(g.homeRow);
  const awayName = rowToName(g.awayRow);
  const winnerName = rowToName(g.winnerRow);
  const recStart = recordsStart + g.record * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 0); // STADIUM_BYTE_OFFSET = 0, confirmed elsewhere in this project
  console.log(`Record ${g.record}: ${awayName} @ ${homeName} (winner: ${winnerName})  |  Stadium raw word: ${stadiumWord} (0x${stadiumWord.toString(16)})`);
}

// Don't trust either "15" (the old hardcoded value) or "16" (this
// session's correction) blindly - scan a range and show real counts +
// matchups per week value, so whichever one actually matches real
// conference championship games is settled by the data itself.
console.log('\nScanning SeasonWeek values 13-18 across all records (no FBS filter), showing matchups for each:');
for (let targetWeek = 13; targetWeek <= 18; targetWeek++) {
  let count = 0;
  const sample = [];
  for (let i = 0; i < recordCount; i++) {
    let week;
    try { week = seasonGameTable.records[i]?.['SeasonWeek']; } catch { continue; }
    if (week !== targetWeek) continue;
    count++;
    if (sample.length < 5) {
      const m = readMatchup(buf, recordsStart, recordSize, i);
      const homeIsFbs = m.home.tableId === 6339; // confirmed real Team tableId
      const awayIsFbs = m.away.tableId === 6339;
      const homeName = homeIsFbs ? rowToName(m.home.row) : `<non-FBS tableId=${m.home.tableId}>`;
      const awayName = awayIsFbs ? rowToName(m.away.row) : `<non-FBS tableId=${m.away.tableId}>`;
      sample.push(`${awayName} @ ${homeName}`);
    }
  }
  console.log(`  SeasonWeek=${targetWeek}: ${count} record(s). Sample matchups: ${sample.join(' | ') || '(none)'}`);
}
