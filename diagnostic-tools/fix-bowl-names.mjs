// WRITES to a NEW save file - never touches your original.
//
//   node fix-bowl-names.mjs "path\to\DYNASTY-SAVEFP" "path\to\output-file"
//
// Restores the 16 BowlGame table records whose Name field got
// overwritten to "CFP First Round" back to their real bowl names,
// confirmed directly against an unaffected save via
// compare-bowlgame-table.mjs. Every other BowlGame record (and every
// SeasonGame record) is left completely untouched.
import path from 'path';
import Franchise from 'madden-franchise';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-bowl-names.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

const CORRECT_NAMES = {
  5: 'Boca Raton Bowl',
  6: 'Citrus Bowl',
  18: 'Cure Bowl',
  19: "Duke's Mayo Bowl",
  21: 'Famous Idaho Potato Bowl',
  23: 'First Responder Bowl',
  24: 'Frisco Bowl',
  26: 'Gator Bowl',
  30: 'Independence Bowl',
  34: 'Music City Bowl',
  35: 'Myrtle Beach Bowl',
  36: 'New Mexico Bowl',
  37: 'New Orleans Bowl',
  40: 'Reliaquest Bowl',
  42: 'Sun Bowl',
  44: 'Xbox Bowl',
};

const franchise = await Franchise.create(inputPath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await table.readRecords();

console.log('Before -> after:');
for (const [indexStr, correctName] of Object.entries(CORRECT_NAMES)) {
  const index = parseInt(indexStr, 10);
  const rec = table.records[index];
  const before = rec['Name'];
  rec['Name'] = correctName;
  console.log(`  Record ${index}: "${before}" -> "${rec['Name']}"`);
}

// NOTE: this save call is the one part of this script I can't verify
// myself (no madden-franchise available in my own sandbox) - if this
// throws, paste the exact error back and we'll adjust to whatever the
// real API actually is, same as every other script this session.
await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched. Load this new file to confirm the bowl names are back to normal.');
