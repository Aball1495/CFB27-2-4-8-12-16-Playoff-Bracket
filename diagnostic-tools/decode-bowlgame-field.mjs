// Read-only diagnostic - does NOT modify the save.
//
//   node decode-bowlgame-field.mjs "path\to\save" <record>
//
// Decodes the BowlGame field (discovered as a separate field from
// Stadium on native NY6 slot records) and dumps whatever table/row it
// points to, if that table exists.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, recordArg] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node decode-bowlgame-field.mjs <save-path> [record]');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const targetRecords = recordArg ? [parseInt(recordArg, 10)] : [928, 929, 930, 931, 932, 933];
let bowlGameTable = null;

for (const recordIndex of targetRecords) {
  const rec = seasonGameTable.records[recordIndex];
  if (!rec) { console.log(`Record ${recordIndex}: null/empty.`); continue; }

  let bowlGameStr;
  try { bowlGameStr = rec['BowlGame']; } catch { console.log(`Record ${recordIndex}: no BowlGame field.`); continue; }
  const word = parseInt(bowlGameStr, 2);
  const decoded = decodeRef(word);

  if (!bowlGameTable) {
    bowlGameTable = franchise.tables.find(t => t.header.tableId === decoded.tableId);
    if (bowlGameTable) await bowlGameTable.readRecords();
  }
  if (!bowlGameTable) { console.log(`Record ${recordIndex}: BowlGame -> tableId=${decoded.tableId} row=${decoded.row} (table not found)`); continue; }

  const bgRec = bowlGameTable.records[decoded.row];
  if (!bgRec) { console.log(`Record ${recordIndex}: BowlGame row ${decoded.row} is null.`); continue; }

  let name, logoId, presId;
  try { name = bgRec['Name']; } catch { name = '?'; }
  try { logoId = bgRec['BowlLogoId']; } catch { logoId = '?'; }
  try { presId = bgRec['PresentationId']; } catch { presId = '?'; }

  console.log(`Record ${recordIndex}: BowlGame row=${decoded.row}  Name="${name}"  BowlLogoId=${logoId}  PresentationId=${presId}`);
}
