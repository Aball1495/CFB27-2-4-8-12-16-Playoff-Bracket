// Read-only diagnostic - does NOT modify the save.
//
//   node dump-remaining-bowl-raws.mjs "path\to\save"
//
// Pulls the exact Stadium raw word (confirmed offset +4) directly from
// each regular-bowl record whose real-world site matches one of the
// remaining target venues - so these get hardcoded from actually-
// confirmed data, not inferred from real-world bowl-site knowledge like
// everything else in this feature so far.
import path from 'path';
import { openSave, readMatchup, TEAM_TABLE_ID } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-remaining-bowl-raws.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const { unpackedFileContents, recordsStart, recordSize, recordCount } = await openSave(savePath, schemaDirectory);
const buf = Buffer.from(unpackedFileContents);

const TARGETS = [
  { record: 394, bowl: 'Las Vegas Bowl', venue: 'Allegiant Stadium' },
  { record: 392, bowl: "Duke's Mayo Bowl", venue: 'Bank of America Stadium' },
  { record: 399, bowl: 'Citrus Bowl', venue: 'Camping World Stadium' },
  { record: 390, bowl: 'Pop-Tarts Bowl', venue: 'Camping World Stadium (alt)' },
  { record: 393, bowl: 'Music City Bowl', venue: 'Nissan Stadium' },
  { record: 400, bowl: 'Texas Bowl', venue: 'NRG Stadium' },
  { record: 380, bowl: 'Gasparilla Bowl', venue: 'Raymond James Stadium' },
  { record: 398, bowl: 'Reliaquest Bowl', venue: 'Raymond James Stadium (alt)' },
  { record: 395, bowl: 'Gator Bowl', venue: 'Everbank Stadium' },
];

for (const t of TARGETS) {
  if (t.record >= recordCount) { console.log(`${t.bowl}: record ${t.record} out of range.`); continue; }
  const m = readMatchup(buf, recordsStart, recordSize, t.record);
  const homeIsFbs = m.home.tableId === TEAM_TABLE_ID;
  const awayIsFbs = m.away.tableId === TEAM_TABLE_ID;
  const homeName = homeIsFbs ? rowToName(m.home.row) : '<TBD/non-FBS>';
  const awayName = awayIsFbs ? rowToName(m.away.row) : '<TBD/non-FBS>';
  const recStart = recordsStart + t.record * recordSize;
  const stadiumWord = buf.readUInt32BE(recStart + 4);
  console.log(`${t.bowl} (record ${t.record}, -> ${t.venue}): ${awayName} @ ${homeName}  |  raw=${stadiumWord} (0x${stadiumWord.toString(16)})`);
}
