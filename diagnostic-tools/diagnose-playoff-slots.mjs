#!/usr/bin/env node
/**
 * Finds the actual record indices for each playoff round by reading
 * SeasonWeekType from the save. After the game update, the slot numbers
 * we previously hardcoded (924-931 etc.) may have shifted.
 *
 * SeasonWeekType values for playoffs:
 *   BowlSeason1 = Conference Championships (week 16)
 *   BowlSeason2 = First Round (CFP Round 1)
 *   BowlSeason3 = Quarterfinals
 *   BowlSeason4 = Semifinals
 *   NationalChampionship = Championship
 *
 * Usage:
 *   node diagnose-playoff-slots.mjs "<path to save>"
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-playoff-slots.mjs "<path to save>"');
  process.exit(1);
}

async function main() {
  const Franchise = (await import('madden-franchise')).default;
  const { resolveTable, TABLE_UNIQUE_IDS } = await import('./playoffEditorCore.mjs');
  const { rowToName } = await import('./teamLookup.mjs');

  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(__dirname, 'schemas', '472_0.gz') },
  });

  const sgTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  await sgTable.readRecords();

  const teamTableId = franchise.tables
    .filter(t => t.name === 'Team')
    .reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a))
    .header.tableId;

  function decodeRef32(s) {
    if (!s || typeof s !== 'string' || s.length !== 32) return null;
    const t = parseInt(s.slice(0, 15), 2);
    const r = parseInt(s.slice(15), 2);
    if (!t && !r) return null;
    return { t, r };
  }

  const playoffWeekTypes = ['BowlSeason1', 'BowlSeason2', 'BowlSeason3', 'BowlSeason4', 'NationalChampionship', 'LastPlayoff_', 'FirstPlayoff_'];
  const slots = {};

  for (let i = 0; i < sgTable.records.length; i++) {
    const rec = sgTable.records[i];
    if (!rec) continue;

    let weekType, status, seasonWeek, bowlRef;
    try { weekType = rec['SeasonWeekType']; } catch { continue; }
    if (!playoffWeekTypes.includes(weekType)) continue;

    try { status = rec['GameStatus']; } catch { status = '?'; }
    try { seasonWeek = rec['SeasonWeek']; } catch { seasonWeek = '?'; }
    try {
      const br = rec['BowlGame'];
      bowlRef = (br && br !== '00000000000000000000000000000000') ? br : null;
    } catch { bowlRef = null; }

    const homeRef = decodeRef32(rec['HomeTeam']);
    const awayRef = decodeRef32(rec['AwayTeam']);
    const homeName = homeRef && homeRef.t === teamTableId ? rowToName(homeRef.r) : '(empty)';
    const awayName = awayRef && awayRef.t === teamTableId ? rowToName(awayRef.r) : '(empty)';

    if (!slots[weekType]) slots[weekType] = [];
    slots[weekType].push({ record: i, homeName, awayName, status, seasonWeek, bowlRef });
  }

  const order = ['BowlSeason1', 'FirstPlayoff_', 'BowlSeason2', 'BowlSeason3', 'BowlSeason4', 'NationalChampionship', 'LastPlayoff_'];
  const labels = {
    BowlSeason1: 'Conf Championships (BowlSeason1)',
    FirstPlayoff_: 'FirstPlayoff_ (alias for BowlSeason2)',
    BowlSeason2: 'CFP First Round / BowlSeason2',
    BowlSeason3: 'Quarterfinals / BowlSeason3',
    BowlSeason4: 'Semifinals / BowlSeason4',
    NationalChampionship: 'National Championship',
    LastPlayoff_: 'LastPlayoff_ (alias)',
  };

  for (const wt of order) {
    if (!slots[wt]) continue;
    console.log(`\n${labels[wt] || wt} — ${slots[wt].length} slot(s):`);
    for (const s of slots[wt]) {
      console.log(`  Record ${s.record} (week ${s.seasonWeek}${s.bowlRef ? ', bowl=' + s.bowlRef : ''}): ${s.homeName} vs ${s.awayName} [${s.status}]`);
    }
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
