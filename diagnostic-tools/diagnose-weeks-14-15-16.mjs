import path from 'path';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const SAVE_PATH = process.argv[2];
const SCHEMA_DIR = process.argv[3] || 'schemas';

if (!SAVE_PATH) {
  console.error('Usage: node diagnose-weeks-14-15-16.mjs <savePath> [schemaDir]');
  process.exit(1);
}

async function main() {
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(SAVE_PATH, {
    schemaDirectory: SCHEMA_DIR,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(SCHEMA_DIR, '472_0.gz') },
  });

  const sgTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  await sgTable.readRecords();

  const byWeek = { 14: [], 15: [], 16: [] };

  for (let i = 0; i < sgTable.records.length; i++) {
    const rec = sgTable.records[i];
    if (!rec) continue;

    let seasonWeek, weekType, status, month, day, homeRef, awayRef;
    try { seasonWeek = rec['SeasonWeek']; } catch { continue; }
    if (!(seasonWeek in byWeek)) continue;

    try { weekType = rec['SeasonWeekType']; } catch { weekType = '?'; }
    try { status = rec['GameStatus']; } catch { status = '?'; }
    try { month = rec['GameDateMonth']; } catch { month = '?'; }
    try { day = rec['GameDateDay']; } catch { day = '?'; }

    let homeName = 'TBD', awayName = 'TBD';
    try {
      const h = rec['HomeTeam'];
      const a = rec['AwayTeam'];
      const decodeRef32 = (s) => {
        if (!s || typeof s !== 'string' || s.length !== 32) return null;
        const t = parseInt(s.slice(0, 15), 2);
        const r = parseInt(s.slice(15), 2);
        if (!t && !r) return null;
        return { t, r };
      };
      const hRef = decodeRef32(h);
      const aRef = decodeRef32(a);
      if (hRef) homeName = rowToName(hRef.r);
      if (aRef) awayName = rowToName(aRef.r);
    } catch { /* leave as TBD */ }

    byWeek[seasonWeek].push({ record: i, homeName, awayName, weekType, status, month, day });
  }

  for (const wk of [14, 15, 16]) {
    const games = byWeek[wk];
    console.log(`\n=== SeasonWeek ${wk}: ${games.length} game(s) ===`);
    for (const g of games) {
      console.log(`  record ${g.record}: ${g.homeName} vs ${g.awayName} | ${g.weekType} | ${g.status} | date ${g.month}/${g.day}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
