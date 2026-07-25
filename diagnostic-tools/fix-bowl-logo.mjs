// WRITES to a NEW save file - never touches your original.
//
//   node fix-bowl-logo.mjs "path\to\save" "path\to\output"
//
// Copies AssetName, BowlLogoId, and the BOWL_PRIMARY_COLOR fields from
// a matching native CFP First Round row into each of the 4 repurposed
// bowls' own rows - confirmed via check-bowl-logo.mjs that these are
// exactly what still differs after the IsPlayoffBowl/PlayoffBracketSlot
// fix (which correctly fixed commentary/field markings, but not the
// mid-field logo or jersey patch). Plain string/int fields, same
// simple property-assignment + franchise.save() approach as the Name
// and IsPlayoffBowl fixes - no raw-buffer workaround needed.
import path from 'path';
import Franchise from 'madden-franchise';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-bowl-logo.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

const franchise = await Franchise.create(inputPath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
const bowlTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await bowlTable.readRecords();

// Each repurposed bowl paired with a native row to copy from - order
// doesn't matter functionally, just keeping it simple/consistent.
const PAIRS = [
  { name: 'Boca Raton Bowl', row: 5, sourceRow: 7 },
  { name: 'Cure Bowl', row: 18, sourceRow: 8 },
  { name: 'Gasparilla Bowl', row: 25, sourceRow: 9 },
  { name: 'New Orleans Bowl', row: 37, sourceRow: 10 },
];

const FIELDS_TO_COPY = ['AssetName', 'BowlLogoId', 'BOWL_PRIMARY_COLOR_R', 'BOWL_PRIMARY_COLOR_G', 'BOWL_PRIMARY_COLOR_B', 'BOWL_SECONDARY_COLOR_R', 'BOWL_SECONDARY_COLOR_G', 'BOWL_SECONDARY_COLOR_B', 'BOWL_TERTIARY_COLOR_R', 'BOWL_TERTIARY_COLOR_G', 'BOWL_TERTIARY_COLOR_B'];

for (const { name, row, sourceRow } of PAIRS) {
  const rec = bowlTable.records[row];
  const sourceRec = bowlTable.records[sourceRow];
  console.log(`${name} (row ${row}) <- native row ${sourceRow}:`);
  for (const field of FIELDS_TO_COPY) {
    let before, sourceVal;
    try { before = rec[field]; } catch { before = '<error>'; }
    try { sourceVal = sourceRec[field]; } catch { sourceVal = '<error>'; continue; }
    rec[field] = sourceVal;
    console.log(`  ${field}: ${before} -> ${rec[field]}`);
  }
}

await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched.');
console.log('\nNote: Trophy field was left untouched (still the original bowl trophy) - lower priority, worth a separate check if it turns out to matter cosmetically.');
