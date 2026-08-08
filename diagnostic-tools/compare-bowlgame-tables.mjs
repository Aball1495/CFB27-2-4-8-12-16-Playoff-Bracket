// Read-only diagnostic - does NOT modify the save.
//
//   node compare-bowlgame-tables.mjs "path\to\save"
//
// Checks which BowlGame table (tableId) backs regular bowls vs native
// NY6 slots, to see if they use completely different tables - which
// would explain why forward conversion (regular → CFP) works fine but
// the reverse doesn't.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) { console.error('Usage: node compare-bowlgame-tables.mjs <save-path>'); process.exit(1); }
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const SAMPLES = [
  { record: 369, label: 'Regular bowl (369 - Independence Bowl)' },
  { record: 380, label: 'Regular bowl (380 - Gasparilla Bowl)' },
  { record: 395, label: 'Regular bowl (395 - Gator Bowl)' },
  { record: 928, label: 'Native NY6 slot (928)' },
  { record: 929, label: 'Native NY6 slot (929)' },
  { record: 930, label: 'Native NY6 slot (930)' },
  { record: 931, label: 'Native NY6 slot (931)' },
  { record: 932, label: 'Native semifinal (932)' },
  { record: 933, label: 'Native semifinal (933)' },
  { record: 401, label: 'Championship (401)' },
];

for (const { record, label } of SAMPLES) {
  const rec = seasonGameTable.records[record];
  if (!rec) { console.log(`${label}: null record`); continue; }
  let bgStr;
  try { bgStr = rec['BowlGame']; } catch { console.log(`${label}: no BowlGame field`); continue; }
  const { tableId, row } = decodeRef(parseInt(bgStr, 2));
  const bgTable = franchise.tables.find(t => t.header.tableId === tableId);
  console.log(`${label}: BowlGame -> tableId=${tableId} (name="${bgTable?.header?.name ?? 'NOT FOUND'}") row=${row}`);
}
