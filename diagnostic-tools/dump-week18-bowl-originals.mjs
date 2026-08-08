// Read-only diagnostic - does NOT modify the save.
//
//   node dump-week18-bowl-originals.mjs "path\to\save"
//
// Dumps the exact branding field values for the 6 week-18 regular bowl
// rows we want to repurpose for NY6 leftover slots (rows 6, 19, 23, 26,
// 40, 42 from the map-bowlgame-rows output), formatted as JS object
// literals ready to paste into NY6_REPURPOSED_BOWLS, matching the same
// structure as CFP_REPURPOSED_BOWLS.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) { console.error('Usage: node dump-week18-bowl-originals.mjs <save-path>'); process.exit(1); }
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

let bgTableId = null;
for (const rec of seasonGameTable.records) {
  if (!rec) continue;
  let bgStr; try { bgStr = rec['BowlGame']; } catch { continue; }
  const { tableId } = decodeRef(parseInt(bgStr, 2));
  if (tableId) { bgTableId = tableId; break; }
}
const bgTable = franchise.tables.find(t => t.header.tableId === bgTableId);
await bgTable.readRecords();

// The 6 week-18 bowl rows we want to use for the 6 NY6 leftover slots.
// Row 44 (Xbox Bowl) and 43 (Texas Bowl) are included as spares for
// the 2-team format which needs 6 slots.
const TARGET_ROWS = [
  { row: 6, name: 'Citrus Bowl', seasonGame: 399 },
  { row: 19, name: "Duke's Mayo Bowl", seasonGame: 392 },
  { row: 23, name: 'First Responder Bowl', seasonGame: 385 },
  { row: 26, name: 'Gator Bowl', seasonGame: 395 },
  { row: 40, name: 'Reliaquest Bowl', seasonGame: 398 },
  { row: 42, name: 'Sun Bowl', seasonGame: 396 },
];

const BRANDING_FIELDS = ['Name', 'AssetName', 'BowlLogoId', 'PresentationId',
  'BOWL_PRIMARY_COLOR_R', 'BOWL_PRIMARY_COLOR_G', 'BOWL_PRIMARY_COLOR_B',
  'BOWL_SECONDARY_COLOR_R', 'BOWL_SECONDARY_COLOR_G', 'BOWL_SECONDARY_COLOR_B',
  'BOWL_TERTIARY_COLOR_R', 'BOWL_TERTIARY_COLOR_G', 'BOWL_TERTIARY_COLOR_B',
  'IsPlayoffBowl', 'PlayoffBracketSlot'];

for (const { row, name, seasonGame } of TARGET_ROWS) {
  const rec = bgTable.records[row];
  if (!rec) { console.log(`Row ${row} (${name}): null`); continue; }
  const vals = {};
  for (const f of BRANDING_FIELDS) {
    try { vals[f] = rec[f]; } catch { /* skip */ }
  }
  console.log(`  { name: '${name}', row: ${row}, seasonGame: ${seasonGame},`);
  console.log(`    original: { Name: '${vals.Name}', AssetName: '${vals.AssetName}', BowlLogoId: ${vals.BowlLogoId}, PresentationId: ${vals.PresentationId},`);
  console.log(`      BOWL_PRIMARY_COLOR_R: ${vals.BOWL_PRIMARY_COLOR_R}, BOWL_PRIMARY_COLOR_G: ${vals.BOWL_PRIMARY_COLOR_G}, BOWL_PRIMARY_COLOR_B: ${vals.BOWL_PRIMARY_COLOR_B},`);
  console.log(`      BOWL_SECONDARY_COLOR_R: ${vals.BOWL_SECONDARY_COLOR_R}, BOWL_SECONDARY_COLOR_G: ${vals.BOWL_SECONDARY_COLOR_G}, BOWL_SECONDARY_COLOR_B: ${vals.BOWL_SECONDARY_COLOR_B},`);
  console.log(`      BOWL_TERTIARY_COLOR_R: ${vals.BOWL_TERTIARY_COLOR_R}, BOWL_TERTIARY_COLOR_G: ${vals.BOWL_TERTIARY_COLOR_G}, BOWL_TERTIARY_COLOR_B: ${vals.BOWL_TERTIARY_COLOR_B},`);
  console.log(`      IsPlayoffBowl: ${vals.IsPlayoffBowl}, PlayoffBracketSlot: ${vals.PlayoffBracketSlot} } },`);
  console.log('');
}
