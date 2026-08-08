// Read-only diagnostic - does NOT modify the save.
//
//   node dump-semifinal-stadiums.mjs "path\to\save"
//
// Checks the two Semifinal slots (932, 933) and the Championship slot
// (401) at the confirmed-correct Stadium offset (+4), now that the
// bracket has advanced far enough for these to be set.
import path from 'path';
import { openSave, readMatchup, TEAM_TABLE_ID, resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-semifinal-stadiums.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const tableIdsPresent = new Map(franchise.tables.map(t => [t.header.tableId, t.header.name]));

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}

function printGame(recordIndex, label) {
  const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
  const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
  const recStart = recordsStart + recordIndex * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 4); // confirmed offset
  const decoded = decodeRef(stadiumWord);
  const tableName = tableIdsPresent.get(decoded.tableId);
  console.log(`${label} (record ${recordIndex}): ${awayName} @ ${homeName}  |  raw=${stadiumWord} (0x${stadiumWord.toString(16)})  ->  tableId=${decoded.tableId} row=${decoded.row}  [${tableName ? `table exists: "${tableName}"` : 'NO SUCH TABLE'}]`);
}

console.log('=== Semifinals + Championship ===');
[932, 933, 401].forEach(r => { if (r < recordCount) printGame(r, r === 401 ? 'Championship' : `Semifinal (${r})`); });
