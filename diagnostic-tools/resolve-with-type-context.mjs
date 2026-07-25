// Read-only diagnostic - does NOT modify the save.
//
//   node resolve-with-type-context.mjs "path\to\save"
//
// getReferencedRecord wants a raw binary-digit string (confirmed by
// its own error message) - field.value already IS that, but passing
// just that alone silently returned nothing. Checking the function's
// actual parameter count, and trying to pass the field's own type
// info as a second argument, since "Stadium" is a polymorphic
// reference type that likely needs that context to resolve correctly.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node resolve-with-type-context.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('getReferencedRecord expects', franchise.getReferencedRecord.length, 'argument(s) (function.length)');
console.log('Function source (if not native):');
console.log(franchise.getReferencedRecord.toString().slice(0, 800));
console.log('');

const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}

const rec = seasonTable.records[371];
const homeField = getFieldObj(rec, 'HomeTeam');
const stadiumField = getFieldObj(rec, 'Stadium');

console.log('\n=== Trying HomeTeam (known-good case) with various second arguments ===');
const attempts = [
  ['value only', () => franchise.getReferencedRecord(homeField.value)],
  ['value + offset object', () => franchise.getReferencedRecord(homeField.value, homeField._offset)],
  ['value + type string', () => franchise.getReferencedRecord(homeField.value, homeField._offset.type)],
  ['value + field name', () => franchise.getReferencedRecord(homeField.value, homeField._key)],
];
for (const [label, fn] of attempts) {
  try {
    const result = fn();
    console.log(`  ${label}: ${result ? 'SUCCESS' : 'null/undefined'}`);
    if (result) { try { console.log(`    ->`, result['Name'] ?? result['FirstName'] ?? Object.keys(result).slice(0,5)); } catch {} }
  } catch (e) {
    console.log(`  ${label}: threw - ${e.message}`);
  }
}

console.log('\n=== Same attempts on Stadium ===');
const attempts2 = [
  ['value only', () => franchise.getReferencedRecord(stadiumField.value)],
  ['value + offset object', () => franchise.getReferencedRecord(stadiumField.value, stadiumField._offset)],
  ['value + type string', () => franchise.getReferencedRecord(stadiumField.value, stadiumField._offset.type)],
  ['value + field name', () => franchise.getReferencedRecord(stadiumField.value, stadiumField._key)],
];
for (const [label, fn] of attempts2) {
  try {
    const result = fn();
    console.log(`  ${label}: ${result ? 'SUCCESS' : 'null/undefined'}`);
    if (result) { try { console.log(`    ->`, result['Name']); } catch {} }
  } catch (e) {
    console.log(`  ${label}: threw - ${e.message}`);
  }
}
