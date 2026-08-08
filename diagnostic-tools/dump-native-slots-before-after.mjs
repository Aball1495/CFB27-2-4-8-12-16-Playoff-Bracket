// Read-only diagnostic - does NOT modify the save.
//
//   node dump-native-slots-before-after.mjs "path\to\save"
//
// Dumps current team assignments for every native playoff slot
// (924-933) plus the Championship (401). Run this BEFORE an Apply,
// then again on the OUTPUT file AFTER the Apply, to see exactly which
// records actually changed - the reliable way to confirm which slots a
// given bracket size leaves genuinely untouched, rather than trusting
// RESERVED_BY_SIZE's assumptions blind.
import path from 'path';
import { openSave, readMatchup, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-native-slots-before-after.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const SLOTS = [924, 925, 926, 927, 928, 929, 930, 931, 932, 933, 401];
for (const r of SLOTS) {
  if (r >= recordCount) { console.log(`Record ${r}: out of range.`); continue; }
  const m = readMatchup(buf, recordsStart, recordSize, r);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
  const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
  const recStart = recordsStart + r * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 4);
  console.log(`Record ${r}: ${awayName} @ ${homeName}  |  Stadium raw=${stadiumWord}`);
}
