// WRITES to a NEW save file - never touches your original.
//
//   node fix-bowl-names-v2.mjs "path\to\save" "path\to\output-file"
//
// Restores the BowlGame table records whose Name field got overwritten
// to "CFP First Round" by the earlier MMC mislabeling issue, back to
// their real bowl names. UNLIKE the original version of this script,
// rows 5/18/37 (Boca Raton/Cure/New Orleans) are deliberately excluded
// from the restore list - confirmed via dump-all-bowlgame-flags.mjs
// that these 3 are currently legitimately converted for the real 16-
// team CFP bracket (IsPlayoffBowl=true), not leftover MMC damage. The
// script also double-checks IsPlayoffBowl on every row before touching
// it, as a second safety net against reverting a real playoff game.
import path from 'path';
import Franchise from 'madden-franchise';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-bowl-names-v2.mjs <input-save> <output-save>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

// Rows 5, 18, 37 deliberately removed from this list vs. the original
// script - those are our own legitimate CFP conversions right now.
const CORRECT_NAMES = {
  6: 'Citrus Bowl',
  19: "Duke's Mayo Bowl",
  21: 'Famous Idaho Potato Bowl',
  23: 'First Responder Bowl',
  24: 'Frisco Bowl',
  26: 'Gator Bowl',
  30: 'Independence Bowl',
  34: 'Music City Bowl',
  35: 'Myrtle Beach Bowl',
  36: 'New Mexico Bowl',
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

  // Safety net: skip anything currently flagged as a real playoff
  // game, regardless of what's in our hardcoded list above.
  let isPlayoff = false;
  try { isPlayoff = rec['IsPlayoffBowl'] === true; } catch { /* ignore */ }
  if (isPlayoff) {
    console.log(`  Record ${index}: SKIPPED - currently flagged IsPlayoffBowl=true, not touching a real playoff game.`);
    continue;
  }

  const before = rec['Name'];
  rec['Name'] = correctName;
  console.log(`  Record ${index}: "${before}" -> "${rec['Name']}"`);
}

await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched.');
