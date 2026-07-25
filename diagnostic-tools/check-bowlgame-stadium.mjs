// Read-only diagnostic - does NOT modify the save.
//
//   node check-bowlgame-stadium.mjs "path\to\save"
//
// BowlGame records also have their own Stadium field. Testing the same
// resolution approach against it - if this ALSO fails the same way,
// that confirms it's a problem with the Stadium field TYPE itself
// (wherever it's used), not something specific to SeasonGame.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-bowlgame-stadium.mjs <save-path>');
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

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}

// Check a handful of real bowls, including the 4 our tool repurposes.
for (const i of [5, 18, 25, 37, 1, 4]) {
  const rec = bowlTable.records[i];
  if (!rec) { console.log(`Record ${i}: no record`); continue; }
  let name = null;
  try { name = rec['Name']; } catch { /* ignore */ }
  const stadiumField = getFieldObj(rec, 'Stadium');
  console.log(`Record ${i} (${name}):`);
  if (!stadiumField) {
    console.log('  No Stadium field object found on this record.');
    continue;
  }
  const ref = stadiumField.referenceData;
  console.log(`  Stadium referenceData: tableId=${ref.tableId}, row=${ref.rowNumber}`);
  try {
    const stadiumTable = await franchise.getTableById(ref.tableId);
    if (!stadiumTable) {
      console.log(`  getTableById(${ref.tableId}) returned nothing.`);
      continue;
    }
    console.log(`  Resolved! uniqueId=${stadiumTable.header.uniqueId}, name="${stadiumTable.header.name}"`);
    await stadiumTable.readRecords();
    const stadiumRec = stadiumTable.records[ref.rowNumber];
    try { console.log(`  Stadium Name field: "${stadiumRec['Name']}"`); } catch (e) { console.log(`  Name field error: ${e.message}`); }
  } catch (e) {
    console.log(`  getTableById(${ref.tableId}) threw: ${e.message}`);
  }
  console.log('');
}
