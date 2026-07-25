// WRITES to a NEW save file - never touches your original.
//
//   node fix-playoff-bowl-flag.mjs "path\to\save" "path\to\output"
//
// Sets IsPlayoffBowl=true on the 4 repurposed bowls' own BowlGame
// definition rows (5/18/25/37) - NOT by retargeting the reference to
// a native slot's row (that would make two different games point at
// the same BowlGame record, a real duplication risk), just setting
// the flag directly on their own existing, dedicated rows. Confirmed
// via check-bowlgame-reference.mjs: native CFP slots have
// IsPlayoffBowl=true with PlayoffBracketSlot 0-3; these 4 currently
// have IsPlayoffBowl=false, PlayoffBracketSlot=0 - using slots 4-7
// here specifically to avoid colliding with the native ones' 0-3.
//
// Plain bool/int fields - using the same simple property-assignment +
// franchise.save() approach that already worked cleanly for the Name
// field fix, no raw-buffer workaround needed like Stadium required.
import path from 'path';
import Franchise from 'madden-franchise';
import { REGULAR_BOWLS, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node fix-playoff-bowl-flag.mjs <input-save> <output-save>');
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

const REPURPOSED = [
  { name: 'Boca Raton Bowl', row: 5, slot: 4 },
  { name: 'Cure Bowl', row: 18, slot: 5 },
  { name: 'Gasparilla Bowl', row: 25, slot: 6 },
  { name: 'New Orleans Bowl', row: 37, slot: 7 },
];

for (const { name, row, slot } of REPURPOSED) {
  const rec = bowlTable.records[row];
  const before = { isPlayoff: rec['IsPlayoffBowl'], slot: rec['PlayoffBracketSlot'] };
  rec['IsPlayoffBowl'] = true;
  rec['PlayoffBracketSlot'] = slot;
  console.log(`${name} (row ${row}): IsPlayoffBowl ${before.isPlayoff} -> ${rec['IsPlayoffBowl']}, PlayoffBracketSlot ${before.slot} -> ${rec['PlayoffBracketSlot']}`);
}

await franchise.save(outputPath);
console.log(`\nSaved to: ${outputPath}`);
console.log('Your original save was never touched.');
