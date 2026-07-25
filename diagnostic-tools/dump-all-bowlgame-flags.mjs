// Read-only diagnostic - does NOT modify the save.
//
//   node dump-all-bowlgame-flags.mjs "path\to\save"
//
// Dumps every BowlGame row's Name/IsPlayoffBowl/PlayoffBracketSlot, to
// see exactly which rows are currently flagged as real CFP games -
// checking whether this is the same MMC mass-relabeling issue
// recurring on a save that never had the earlier fix applied, or
// something genuinely new.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-all-bowlgame-flags.mjs <save-path>');
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

let flaggedCount = 0;
for (let i = 0; i < bowlTable.records.length; i++) {
  const rec = bowlTable.records[i];
  if (!rec) continue;
  let name, isPlayoff, slot;
  try { name = rec['Name']; } catch { continue; }
  try { isPlayoff = rec['IsPlayoffBowl']; } catch { isPlayoff = '<error>'; }
  try { slot = rec['PlayoffBracketSlot']; } catch { slot = '<error>'; }
  const flagged = isPlayoff === true || name === 'CFP First Round';
  if (flagged) flaggedCount++;
  console.log(`Row ${i}: Name="${name}"  IsPlayoffBowl=${isPlayoff}  PlayoffBracketSlot=${slot}  ${flagged ? '<-- FLAGGED AS PLAYOFF' : ''}`);
}
console.log(`\nTotal rows flagged as playoff: ${flaggedCount} (expected for a full 16-team run: 15 - 4 native Round1 + 4 repurposed Round1 + 4 native QF + 2 native SF + 1 championship)`);
