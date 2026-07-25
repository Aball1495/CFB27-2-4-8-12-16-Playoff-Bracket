// Read-only diagnostic - does NOT modify the save.
//
//   node resolve-with-string-formats.mjs "path\to\save"
//
// getReferencedRecord expects a string (it calls .substring on its
// argument internally) - trying a few plausible string formats built
// from the referenceData we already know is correct (tableId 6311,
// real row numbers, confirmed against HomeTeam).
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node resolve-with-string-formats.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}

// Use record 371's HomeTeam (known-correct: tableId 6311, row 41) as
// the test case, since we can verify success against a name we
// already trust (Georgia Southern's home stadium, or just confirming
// we get a real team name back via a Team-table field, if Name exists
// there too) - safer than testing blind against Stadium first.
const rec = seasonTable.records[371];
const homeField = getFieldObj(rec, 'HomeTeam');
const stadiumField = getFieldObj(rec, 'Stadium');

const homeRef = homeField.referenceData;
const stadiumRef = stadiumField.referenceData;

const candidateFormats = [
  `${homeRef.tableId}_${homeRef.rowNumber}`,
  `${homeRef.tableId}-${homeRef.rowNumber}`,
  `${homeRef.tableId}:${homeRef.rowNumber}`,
  `${homeRef.rowNumber}_${homeRef.tableId}`,
];

console.log('Testing string formats against HomeTeam (known: tableId 6311, row 41, should be a real team):\n');
for (const fmt of candidateFormats) {
  try {
    const result = franchise.getReferencedRecord(fmt);
    console.log(`  "${fmt}" -> ${result ? 'SUCCESS, got a record' : 'null/undefined'}`);
    if (result) {
      try { console.log(`    Name field: ${result['Name']}`); } catch { /* ignore */ }
    }
  } catch (e) {
    console.log(`  "${fmt}" -> threw: ${e.message}`);
  }
}

console.log('\nNow trying the same winning format (if any) against Stadium (tableId', stadiumRef.tableId, ', row', stadiumRef.rowNumber, '):\n');
for (const fmt of [
  `${stadiumRef.tableId}_${stadiumRef.rowNumber}`,
  `${stadiumRef.tableId}-${stadiumRef.rowNumber}`,
  `${stadiumRef.tableId}:${stadiumRef.rowNumber}`,
]) {
  try {
    const result = franchise.getReferencedRecord(fmt);
    console.log(`  "${fmt}" -> ${result ? 'SUCCESS' : 'null/undefined'}`);
    if (result) {
      try { console.log(`    Name field: ${result['Name']}`); } catch { /* ignore */ }
    }
  } catch (e) {
    console.log(`  "${fmt}" -> threw: ${e.message}`);
  }
}
