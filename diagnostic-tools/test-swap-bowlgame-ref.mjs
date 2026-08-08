// WRITES to a new output file - does NOT touch your input save.
//
//   node test-swap-bowlgame-ref.mjs "path\to\save" <slotRecord> <targetBowlGameRow> "output.sav"
//
// Raw-buffer-swaps the SeasonGame record's BowlGame reference field to
// point at a different BowlGame row - e.g. redirect slot 928 from
// its native CFP row (12) to a real regular bowl's row (26 = Gator
// Bowl). Tests whether the engine follows this reference for
// presentation (no CFP branding) or ignores it and always CFP-brands
// records 928-931 based on slot number alone.
//
// Examples:
//   node test-swap-bowlgame-ref.mjs "save.sav" 928 26 "test-swap-928-gator.sav"
//   node test-swap-bowlgame-ref.mjs "save.sav" 928 25 "test-swap-928-gasparilla.sav"
import path from 'path';
import fs from 'fs';
import Franchise from 'madden-franchise';
import { openSave, repackSave, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, slotRecordArg, targetRowArg, outputName] = process.argv.slice(2);
if (!savePath || !slotRecordArg || !targetRowArg || !outputName) {
  console.error('Usage: node test-swap-bowlgame-ref.mjs <save-path> <slotRecord> <targetBowlGameRow> <output.sav>');
  process.exit(1);
}
const slotRecord = parseInt(slotRecordArg, 10);
const targetRow = parseInt(targetRowArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }
function encodeRef(tableId, row) { return (tableId << 17) | row; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const rec = seasonGameTable.records[slotRecord];
if (!rec) { console.error(`Record ${slotRecord} is null.`); process.exit(1); }

// Find BowlGame's byte offset in the SeasonGame record.
const bgOffsetInfo = rec._offsetTable?.find(f => f.name === 'BowlGame');
if (!bgOffsetInfo) { console.error('Could not find BowlGame in SeasonGame _offsetTable.'); process.exit(1); }
const bgByteOffset = bgOffsetInfo.offset / 8;
console.log(`BowlGame field on SeasonGame: bit offset=${bgOffsetInfo.offset}, byte offset=${bgByteOffset}, length=${bgOffsetInfo.length} bits`);

// Read the current reference.
const { unpackedFileContents, recordsStart, recordSize } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);
const recStart = recordsStart + slotRecord * recordSize;
const currentWord = buf.readUInt32BE(recStart + bgByteOffset);
const currentDecoded = decodeRef(currentWord);
console.log(`Current BowlGame ref: raw=${currentWord} -> tableId=${currentDecoded.tableId} row=${currentDecoded.row}`);

// Confirm the target row lives in the same BowlGame table.
const bgTable = franchise.tables.find(t => t.header.tableId === currentDecoded.tableId);
if (!bgTable) { console.error(`BowlGame tableId ${currentDecoded.tableId} not found.`); process.exit(1); }
await bgTable.readRecords();
const targetRec = bgTable.records[targetRow];
if (!targetRec) { console.error(`Target row ${targetRow} is null in BowlGame table.`); process.exit(1); }
let targetName;
try { targetName = targetRec['Name']; } catch { targetName = '?'; }
let targetIsPlayoff;
try { targetIsPlayoff = targetRec['IsPlayoffBowl']; } catch { targetIsPlayoff = '?'; }
console.log(`Target BowlGame row ${targetRow}: Name="${targetName}" IsPlayoffBowl=${targetIsPlayoff}`);

// Write the swapped reference - same tableId, new row.
const newWord = encodeRef(currentDecoded.tableId, targetRow);
buf.writeUInt32BE(newWord >>> 0, recStart + bgByteOffset);
console.log(`\nSwapped: raw=${newWord} -> tableId=${currentDecoded.tableId} row=${targetRow}`);

const originalRawBuf = fs.readFileSync(savePath);
const finalBuf = repackSave(originalRawBuf, buf);
const outputPath = path.join(path.dirname(savePath), outputName);
fs.writeFileSync(outputPath, finalBuf);
console.log(`\nWrote ${outputPath}. Load this in-game and check slot ${slotRecord}'s game - does it now present as "${targetName}" (no CFP branding) or still as a CFP Quarterfinal?`);
