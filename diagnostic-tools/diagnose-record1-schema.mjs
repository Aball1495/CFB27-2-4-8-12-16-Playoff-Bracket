import path from 'path';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const SAVE_PATH = process.argv[2];
const SCHEMA_DIR = process.argv[3] || 'schemas';

if (!SAVE_PATH) {
  console.error('Usage: node diagnose-record1-schema.mjs <savePath> [schemaDir]');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { t, r };
}

// Records to check: 1 (UAB vs Memphis - the failing one), plus a couple
// known-good ones from the earlier raw-buffer diagnostic for comparison.
const RECORDS_TO_CHECK = [0, 1, 2, 934];

async function main() {
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(SAVE_PATH, {
    schemaDirectory: SCHEMA_DIR,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(SCHEMA_DIR, '472_0.gz') },
  });

  const sgTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  await sgTable.readRecords();

  // Same realTeamTableId resolution findConferenceChampionsByStandings uses.
  const { resolveTeamTableId } = await import('./playoffEditorCore.mjs');
  const realTeamTableId = resolveTeamTableId(franchise);
  console.log(`realTeamTableId = ${realTeamTableId}\n`);

  for (const i of RECORDS_TO_CHECK) {
    const rec = sgTable.records[i];
    console.log(`--- record ${i} ---`);
    if (!rec) { console.log('  no record at this index'); continue; }

    let weekType, seasonWeek, status, homeTeamRaw, awayTeamRaw;
    try { weekType = rec['SeasonWeekType']; } catch (e) { weekType = `ERR: ${e.message}`; }
    try { seasonWeek = rec['SeasonWeek']; } catch (e) { seasonWeek = `ERR: ${e.message}`; }
    try { status = rec['GameStatus']; } catch (e) { status = `ERR: ${e.message}`; }
    try { homeTeamRaw = rec['HomeTeam']; } catch (e) { homeTeamRaw = `ERR: ${e.message}`; }
    try { awayTeamRaw = rec['AwayTeam']; } catch (e) { awayTeamRaw = `ERR: ${e.message}`; }

    console.log(`  SeasonWeekType = ${JSON.stringify(weekType)}`);
    console.log(`  SeasonWeek     = ${JSON.stringify(seasonWeek)}`);
    console.log(`  GameStatus     = ${JSON.stringify(status)}`);
    console.log(`  HomeTeam raw   = ${JSON.stringify(homeTeamRaw)} (type: ${typeof homeTeamRaw}, length: ${homeTeamRaw && homeTeamRaw.length})`);
    console.log(`  AwayTeam raw   = ${JSON.stringify(awayTeamRaw)} (type: ${typeof awayTeamRaw}, length: ${awayTeamRaw && awayTeamRaw.length})`);

    const homeRef = decodeRef32(homeTeamRaw);
    const awayRef = decodeRef32(awayTeamRaw);
    console.log(`  decodeRef32(HomeTeam) = ${JSON.stringify(homeRef)}`);
    console.log(`  decodeRef32(AwayTeam) = ${JSON.stringify(awayRef)}`);

    const passesTableIdCheck = homeRef && homeRef.t === realTeamTableId && awayRef && awayRef.t === realTeamTableId;
    const passesStatusCheck = status === 'HomeWon' || status === 'AwayWon';
    console.log(`  passes tableId check = ${passesTableIdCheck}`);
    console.log(`  passes status check  = ${passesStatusCheck}`);
    console.log(`  --> would be INCLUDED in champGames: ${passesTableIdCheck && passesStatusCheck && seasonWeek === 16}`);
    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
