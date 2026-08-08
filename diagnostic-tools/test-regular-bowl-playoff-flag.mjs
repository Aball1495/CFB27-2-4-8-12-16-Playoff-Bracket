// WRITES to a new output file - does NOT touch your input save.
//
//   node test-regular-bowl-playoff-flag.mjs "path\to\save" <regularBowlRecord> "output-name.sav"
//
// Sets IsPlayoffBowl=true on a REAL regular bowl's BowlGame record
// (leaving everything else - Stadium, branding, teams - untouched), to
// test whether the "orange field vs playoff branding" tradeoff we found
// on the native NY6 leftover slots (928-933) is a generic effect of the
// IsPlayoffBowl flag, or specific to those particular native slots.
//
// Example - test on the Gator Bowl (record 395):
//   node test-regular-bowl-playoff-flag.mjs "save.sav" 395 "test-gator-playoff-flag.sav"
import path from 'path';
import fs from 'fs';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, recordArg, outputName] = process.argv.slice(2);
if (!savePath || !recordArg || !outputName) {
  console.error('Usage: node test-regular-bowl-playoff-flag.mjs <save-path> <regularBowlRecord> <output-name.sav>');
  process.exit(1);
}
const recordIndex = parseInt(recordArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const rec = seasonGameTable.records[recordIndex];
if (!rec) { console.error(`Record ${recordIndex} is null.`); process.exit(1); }
let bowlGameStr;
try { bowlGameStr = rec['BowlGame']; } catch { console.error('No BowlGame reference on this record.'); process.exit(1); }
const decoded = decodeRef(parseInt(bowlGameStr, 2));
const bowlGameTable = franchise.tables.find(t => t.header.tableId === decoded.tableId);
if (!bowlGameTable) { console.error(`BowlGame tableId ${decoded.tableId} not found.`); process.exit(1); }
await bowlGameTable.readRecords();
const bgRec = bowlGameTable.records[decoded.row];
if (!bgRec) { console.error(`BowlGame row ${decoded.row} is null.`); process.exit(1); }

console.log(`Before: Name="${bgRec['Name']}" IsPlayoffBowl=${bgRec['IsPlayoffBowl']}`);
bgRec['IsPlayoffBowl'] = true;
console.log(`After: IsPlayoffBowl=${bgRec['IsPlayoffBowl']} (everything else - Stadium, branding, teams - left untouched)`);

const outputPath = path.join(path.dirname(savePath), outputName);
await franchise.save(outputPath);
console.log(`Wrote ${outputPath}. Load this in-game and check that same game's field - does it now show playoff branding despite being a real, normal regular bowl?`);
