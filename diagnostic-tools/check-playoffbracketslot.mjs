// Read-only diagnostic - does NOT modify the save.
//
//   node check-playoffbracketslot.mjs "path\to\save" <record>
//
// Checks whether PlayoffBracketSlot is actually writable via schema API
// on the BowlGame record for a given SeasonGame slot, since test-2 of
// the IsPlayoffBowl/PlayoffBracketSlot investigation showed it still
// reading back as 4 after a write attempt.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, recordArg] = process.argv.slice(2);
if (!savePath || !recordArg) {
  console.error('Usage: node check-playoffbracketslot.mjs <save-path> <record>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const rec = seasonGameTable.records[parseInt(recordArg, 10)];
let bowlGameStr;
try { bowlGameStr = rec?.['BowlGame']; } catch { console.error('No BowlGame field.'); process.exit(1); }
const decoded = decodeRef(parseInt(bowlGameStr, 2));
const bgTable = franchise.tables.find(t => t.header.tableId === decoded.tableId);
await bgTable.readRecords();
const bgRec = bgTable.records[decoded.row];

console.log('Before write:');
console.log('  PlayoffBracketSlot:', bgRec['PlayoffBracketSlot']);
console.log('  IsPlayoffBowl:', bgRec['IsPlayoffBowl']);

try {
  bgRec['PlayoffBracketSlot'] = 0;
  console.log('  PlayoffBracketSlot write: no exception thrown');
} catch (e) {
  console.log('  PlayoffBracketSlot write THREW:', e.message);
}
try {
  bgRec['IsPlayoffBowl'] = false;
  console.log('  IsPlayoffBowl write: no exception thrown');
} catch (e) {
  console.log('  IsPlayoffBowl write THREW:', e.message);
}

console.log('\nAfter write (in-memory only - not saved):');
console.log('  PlayoffBracketSlot:', bgRec['PlayoffBracketSlot']);
console.log('  IsPlayoffBowl:', bgRec['IsPlayoffBowl']);

// Check the _offsetTable for both fields to see if they even exist in
// the schema for this table version.
const pbs = bgRec._offsetTable?.find(f => f.name === 'PlayoffBracketSlot');
const ipb = bgRec._offsetTable?.find(f => f.name === 'IsPlayoffBowl');
console.log('\nSchema offset info:');
console.log('  PlayoffBracketSlot offset entry:', pbs ? JSON.stringify(pbs) : 'NOT FOUND in _offsetTable');
console.log('  IsPlayoffBowl offset entry:', ipb ? JSON.stringify(ipb) : 'NOT FOUND in _offsetTable');
