// WRITES to a new output file - does NOT touch your input save.
//
//   node apply-test-stadium.mjs "path\to\save" <targetRecord> <rawWord> "output-name.sav"
//
// Writes a specific raw Stadium word (confirmed offset +4 on SeasonGame)
// into one target record, so you can load the output save in-game and
// visually confirm it renders as the expected real-world venue - before
// this gets built into the actual tool as a name-based picker.
//
// Example - confirm the SEC Championship's raw word really is Mercedes-
// Benz Stadium by writing it into next season's SEC title game (once you
// know its record number):
//   node apply-test-stadium.mjs "save.sav" 934 2154012135 "test-mbenz.sav"
import path from 'path';
import fs from 'fs';
import { openSave, readMatchup, repackSave, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, targetRecordArg, rawWordArg, outputName] = process.argv.slice(2);
if (!savePath || !targetRecordArg || !rawWordArg || !outputName) {
  console.error('Usage: node apply-test-stadium.mjs <save-path> <targetRecord> <rawWord> <output-name.sav>');
  process.exit(1);
}
const targetRecord = parseInt(targetRecordArg, 10);
const rawWord = parseInt(rawWordArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');

const originalRawBuf = fs.readFileSync(savePath);
const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

if (targetRecord >= recordCount) {
  console.error(`Record ${targetRecord} is out of range (table has ${recordCount} records).`);
  process.exit(1);
}

const m = readMatchup(buf, recordsStart, recordSize, targetRecord);
const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
console.log(`Target record ${targetRecord}: ${awayName} @ ${homeName}`);

const recStart = recordsStart + targetRecord * recordSize;
const before = buf.readUInt32BE(recStart + 4);
buf.writeUInt32BE(rawWord >>> 0, recStart + 4);
const after = buf.readUInt32BE(recStart + 4);
console.log(`Stadium field: ${before} (0x${before.toString(16)}) -> ${after} (0x${after.toString(16)})`);

const outputPath = path.join(path.dirname(savePath), outputName);
const finalBuf = repackSave(originalRawBuf, buf);
fs.writeFileSync(outputPath, finalBuf);
console.log(`Wrote ${outputPath} (${finalBuf.length} bytes). Load this in-game and check ${homeName}'s game (or whichever side actually hosts) to see what venue this renders as.`);
