// Read-only diagnostic - does NOT modify the save.
//
//   node dump-cfp-native-slot-stadiums.mjs "path\to\save"
//
// Checks the Stadium reference on the native CFP playoff slots
// (924-927 Round 1, 928-931 Quarterfinals/NY6, 932-933 Semifinals, 401
// Championship). These are real bowl games with genuine neutral sites
// (Rose/Sugar/Orange/Cotton/Fiesta/Peach rotation) - unlike conference
// championships (confirmed all-zero/no-override in this save), bowls
// are documented elsewhere in this project as always carrying a real
// Stadium reference, so this is a legitimate lead for the remaining
// NY6-aligned venues (Rose Bowl, AT&T/Cotton, Caesars Superdome/Sugar,
// Hard Rock/Orange, State Farm/Fiesta, Mercedes-Benz/Peach).
import path from 'path';
import { openSave, readMatchup, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-cfp-native-slot-stadiums.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const NATIVE_SLOTS = [
  { record: 924, label: 'Round 1 game 1' },
  { record: 925, label: 'Round 1 game 2' },
  { record: 926, label: 'Round 1 game 3' },
  { record: 927, label: 'Round 1 game 4' },
  { record: 928, label: 'Quarterfinal 1 (NY6)' },
  { record: 929, label: 'Quarterfinal 2 (NY6)' },
  { record: 930, label: 'Quarterfinal 3 (NY6)' },
  { record: 931, label: 'Quarterfinal 4 (NY6)' },
  { record: 932, label: 'Semifinal 1 (NY6)' },
  { record: 933, label: 'Semifinal 2 (NY6)' },
  { record: 401, label: 'Championship' },
];

console.log('Native CFP slot Stadium references:\n');
for (const slot of NATIVE_SLOTS) {
  if (slot.record >= recordCount) { console.log(`${slot.label} (record ${slot.record}): out of range for this table.`); continue; }
  const m = readMatchup(buf, recordsStart, recordSize, slot.record);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
  const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
  const recStart = recordsStart + slot.record * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 0);
  console.log(`${slot.label} (record ${slot.record}): ${awayName} @ ${homeName}  |  Stadium raw word: ${stadiumWord} (0x${stadiumWord.toString(16)})  ${stadiumWord === 0 ? '<-- all-zero, no override' : ''}`);
}
