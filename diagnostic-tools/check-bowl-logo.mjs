// Read-only diagnostic - does NOT modify the save.
//
//   node check-bowl-logo.mjs "path\to\save"
//
// BowlLogoId (and AssetName) likely control the mid-field logo and
// jersey patch specifically - separate from IsPlayoffBowl/
// PlayoffBracketSlot, which already correctly fixed the announcer
// commentary and field markings. Comparing native CFP slots against
// our 4 repurposed bowls to see what differs.
import path from 'path';
import Franchise from 'madden-franchise';
import { REGULAR_BOWLS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-bowl-logo.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await bowlTable.readRecords();

function dump(row, label) {
  const rec = bowlTable.records[row];
  if (!rec) { console.log(`${label} (row ${row}): no record`); return; }
  const fields = {};
  for (const f of ['Name', 'AssetName', 'BowlLogoId', 'BOWL_PRIMARY_COLOR_R', 'BOWL_PRIMARY_COLOR_G', 'BOWL_PRIMARY_COLOR_B', 'Trophy', 'PresentationId']) {
    try { fields[f] = rec[f]; } catch { fields[f] = '<error>'; }
  }
  console.log(`${label} (row ${row}):`, JSON.stringify(fields));
}

console.log('=== Native CFP First Round rows (confirmed correct) ===');
for (const row of [7, 8, 9, 10]) dump(row, 'Native');

console.log('\n=== Our 4 repurposed bowls (logo/patch still wrong) ===');
for (const { name, row } of [
  { name: 'Boca Raton Bowl', row: 5 },
  { name: 'Cure Bowl', row: 18 },
  { name: 'Gasparilla Bowl', row: 25 },
  { name: 'New Orleans Bowl', row: 37 },
]) dump(row, name);
