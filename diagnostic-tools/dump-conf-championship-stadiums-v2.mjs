// Read-only diagnostic - does NOT modify the save.
//
//   node dump-conf-championship-stadiums-v2.mjs "path\to\save"
//
// Uses the already-correct, already-battle-tested findConferenceChampi-
// onsByStandings (which detects championship week dynamically per-save,
// rather than trusting any hardcoded week number - that fragility was
// already discovered and fixed once in this project). For each
// conference with an actual resolved championship game, prints the two
// teams and the game's raw Stadium reference - real-world conference
// title games are neutral-site, so these are legitimate sources to copy
// from (same proven pattern as copyTeamStadiumIntoGame).
import path from 'path';
import Franchise from 'madden-franchise';
import { openSave, findConferenceChampionsByStandings, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { loadTeamConference } from './teamConference.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-conf-championship-stadiums-v2.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const { TEAM_CONFERENCE } = loadTeamConference();

const { confChampions: results, unresolved } = await findConferenceChampionsByStandings(
  buf, recordsStart, recordSize, recordCount, TEAM_CONFERENCE, savePath, schemaDirectory
);

// The function's return value doesn't expose which path each conference
// took - a real neutral-site championship game, or a standings-fallback
// reconstruction from a regular-season (on-campus) game. Using a
// fallback result here would give us the home team's own stadium, not
// a neutral site - wrong for this purpose even though it's a perfectly
// valid champion. Independently re-derive which week is championship
// week (same rule used internally: highest RegularSeason-tagged week
// with more than one game) and only trust a result if its own game
// record actually falls in that week.
const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const weekCounts = new Map();
for (let i = 0; i < seasonGameTable.records.length; i++) {
  const rec = seasonGameTable.records[i];
  if (!rec) continue;
  let weekType, wk;
  try { weekType = rec['SeasonWeekType']; wk = rec['SeasonWeek']; } catch { continue; }
  if (weekType !== 'RegularSeason') continue;
  weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
}
const weeksWithMultipleGames = [...weekCounts.entries()].filter(([, count]) => count > 1).map(([wk]) => wk);
const championshipWeek = weeksWithMultipleGames.length ? Math.max(...weeksWithMultipleGames) : null;
console.log(`Independently-derived championship week for this save: ${championshipWeek}\n`);

console.log(`Resolved ${Object.keys(results).length} conference champion(s):\n`);
for (const [conf, g] of Object.entries(results)) {
  let actualWeek;
  try { actualWeek = seasonGameTable.records[g.record]?.['SeasonWeek']; } catch { actualWeek = null; }
  const isRealChampGame = actualWeek === championshipWeek;
  const recStart = recordsStart + g.record * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 0); // STADIUM_BYTE_OFFSET = 0
  console.log(
    `${conf}: ${g.away} @ ${g.home} -> winner ${g.winner}  |  record ${g.record} (week ${actualWeek})  |  ` +
    `Stadium raw word: ${stadiumWord} (0x${stadiumWord.toString(16)})  ` +
    `${isRealChampGame ? '[REAL CHAMPIONSHIP GAME - safe to use as neutral-site source]' : '[STANDINGS FALLBACK - on-campus game, do NOT use for stadium purposes]'}`
  );
}

if (unresolved?.length) {
  console.log(`\n${unresolved.length} conference(s) unresolved: ${unresolved.map(u => `${u.conf} (${u.reason})`).join(', ')}`);
}

console.log('\nOnly trust rows marked [REAL CHAMPIONSHIP GAME]. Match each one against real-world knowledge of that conference\'s title game site to identify which raw word corresponds to which of your 20 target venues.');
