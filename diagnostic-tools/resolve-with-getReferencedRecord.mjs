// Read-only diagnostic - does NOT modify the save.
//
//   node resolve-with-getReferencedRecord.mjs "path\to\save"
//
// Uses franchise.getReferencedRecord() directly - the library's own
// intended way to resolve any reference field, whatever lazy-loading
// or indexing it needs to do internally. Should finally give us the
// actual Stadium record, name and all, without any more of our own
// guessing.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node resolve-with-getReferencedRecord.mjs <save-path>');
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

for (const i of [370, 371, 924, 925]) {
  const rec = seasonTable.records[i];
  if (!rec) { console.log(`Record ${i}: no record`); continue; }

  const stadiumField = getFieldObj(rec, 'Stadium');
  console.log(`Record ${i}:`);

  if (!stadiumField) {
    console.log('  No Stadium field object found.');
    continue;
  }

  try {
    const targetRecord = franchise.getReferencedRecord(stadiumField.value);
    if (!targetRecord) {
      console.log('  getReferencedRecord(field.value) returned nothing (probably the empty/unset 924-925 case, or wrong argument type).');
    } else {
      let name = null;
      try { name = targetRecord['Name']; } catch { /* ignore */ }
      console.log(`  Resolved via field.value -> Name: "${name}"`);
      console.log(`  Full record keys available: ${Object.keys(targetRecord).filter(k => !k.startsWith('_')).join(', ')}`);
    }
  } catch (e) {
    console.log(`  getReferencedRecord(field.value) threw: ${e.message}`);
  }

  // Also try passing the field object itself, in case that's the
  // expected argument type instead of its raw value.
  try {
    const targetRecord2 = franchise.getReferencedRecord(stadiumField);
    if (targetRecord2) {
      let name2 = null;
      try { name2 = targetRecord2['Name']; } catch { /* ignore */ }
      console.log(`  Resolved via field object itself -> Name: "${name2}"`);
    }
  } catch (e) {
    console.log(`  getReferencedRecord(fieldObject) threw: ${e.message}`);
  }

  console.log('');
}
