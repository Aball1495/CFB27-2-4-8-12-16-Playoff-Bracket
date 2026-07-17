import { openSave, findConferenceChampionshipGames } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import { loadTeamConference } from './teamConference.mjs';

const SAVE_PATH = process.argv[2];
const SCHEMA_DIR = process.argv[3] || 'schemas';

if (!SAVE_PATH) {
  console.error('Usage: node diagnose-american-champ.mjs <savePath> [schemaDir]');
  process.exit(1);
}

async function main() {
  const { unpackedFileContents, recordsStart, recordSize, recordCount } =
    await openSave(SAVE_PATH, SCHEMA_DIR);
  const buf = Buffer.from(unpackedFileContents);

  const { TEAM_CONFERENCE } = loadTeamConference();

  const champGames = findConferenceChampionshipGames(buf, recordsStart, recordSize, recordCount);

  console.log(`Detected ${champGames.length} Week-16 championship games total.\n`);

  let foundAmerican = false;
  for (const g of champGames) {
    const homeName = rowToName(g.homeRow);
    const awayName = rowToName(g.awayRow);
    const homeConf = TEAM_CONFERENCE[homeName];
    const awayConf = TEAM_CONFERENCE[awayName];
    const flag = (homeConf === 'American' || awayConf === 'American') ? '  <-- American' : '';
    if (flag) foundAmerican = true;
    console.log(`  record ${g.record}: ${homeName} (${homeConf}) vs ${awayName} (${awayConf}) - winner: ${rowToName(g.winnerRow)}${flag}`);
  }

  if (!foundAmerican) {
    console.log('\n*** No game involving an American team was detected as a Week-16 championship game. ***');
    console.log('This means findConferenceChampionshipGames() itself is missing this game - likely a');
    console.log('SeasonWeek value or record range issue specific to this game, not a conference-label problem.');
  } else {
    console.log('\nAn American-conference game WAS detected above. If the crown still doesn\'t show,');
    console.log('the issue is in how confFromChampGame keys it (check exact TEAM_CONFERENCE label spelling for Memphis/UAB).');
  }

  console.log(`\nFor reference - TEAM_CONFERENCE['Memphis'] = ${TEAM_CONFERENCE['Memphis']}`);
  console.log(`TEAM_CONFERENCE['UAB'] = ${TEAM_CONFERENCE['UAB']}`);
}

main().catch(e => { console.error(e); process.exit(1); });
