// WRITES to a NEW save file - never touches your original.
//
//   node toggle-repurposed-bowl-names.mjs "path\to\save" "path\to\output" --to-cfp
//   node toggle-repurposed-bowl-names.mjs "path\to\save" "path\to\output" --to-original
//
// Only touches the 4 BowlGame records this tool's 16-team format
// actually repurposes as extra Round 1 slots (Boca Raton, New Orleans,
// Cure, Gasparilla) - nothing else, and never the 16 unrelated bowl
// records that some other tool relabeled separately.
//
// --to-cfp: renames all 4 to "CFP First Round", matching how the 4
//   true native CFP slots already display, so a 16-team bracket reads
//   as 8 consistent playoff games instead of 4 playoff games + 4
//   bowl-branded ones.
// --to-original: renames all 4 back to their real bowl names, in case
//   you ever run a season WITHOUT the 16-team format and want them to
//   read normally again.
import path from 'path';
import Franchise from 'madden-franchise';

const [inputPath, outputPath, modeFlag] = process.argv.slice(2);
if (!inputPath || !outputPath || !['--to-cfp', '--to-original'].includes(modeFlag)) {
  console.error('Usage: node toggle-repurposed-bowl-names.mjs <input-save> <output-save> --to-cfp|--to-original');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const BOWL_GAME_UNIQUE_ID = 902037496;

// The 4 records this tool's 16-team format repurposes, and their real
// names - confirmed directly against an unaffected save.
const REPURPOSED_BOWLS = {
  5: 'Boca Raton Bowl',
  37: 'New Orleans Bowl',
  18: 'Cure Bowl',
  25: 'Gasparilla Bowl',
};

const franchise = await Franchise.create(inputPath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === BOWL_GAME_UNIQUE_ID);
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await table.readRecords();

console.log(`Mode: ${modeFlag === '--to-cfp' ? 'renaming to "CFP First Round"' : 'restoring real bowl names'}\n`);
for (const [indexStr, realName] of Object.entries(REPURPOSED_BOWLS)) {
  const index = parseInt(indexStr, 10);
  const rec = table.records[index];
  const before = rec['Name'];
  const after = modeFlag === '--to-cfp' ? 'CFP First Round' : realName;
  rec['Name'] = after;
  console.log(`  Record ${index}: "${before}" -> "${rec['Name']}"`);
}

await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched.');
