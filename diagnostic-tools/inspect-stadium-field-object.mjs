// Read-only diagnostic - does NOT modify the save.
//
//   node inspect-stadium-field-object.mjs "path\to\save" <recordIndex>
//
// Instead of hand-decoding the raw Stadium reference ourselves (which
// only worked for Team by luck, not because the method was actually
// correct for every reference type), this grabs the library's OWN
// internal field object for "Stadium" directly and inspects what
// properties/methods it actually exposes - if madden-franchise already
// knows how to resolve this reference type correctly, it's on this
// object somewhere, and we should use that instead of reinventing it.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, recordIndexArg] = process.argv.slice(2);
if (!savePath || recordIndexArg === undefined) {
  console.error('Usage: node inspect-stadium-field-object.mjs <save-path> <recordIndex>');
  process.exit(1);
}
const recordIndex = parseInt(recordIndexArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await table.readRecords();

const rec = table.records[recordIndex];
if (!rec) {
  console.error(`No record at index ${recordIndex}`);
  process.exit(1);
}

// Grab the raw fields array directly (bypassing the bracket-notation
// Proxy that gave us the plain binary string before) and find the
// Stadium field object itself.
const fieldsArray = rec._fieldsArray || [];
const stadiumField = fieldsArray.find(f => f.key === 'Stadium' || f.name === 'Stadium');

if (!stadiumField) {
  console.log('Could not find a Stadium field object in _fieldsArray. Field keys/names found:');
  console.log(fieldsArray.map(f => f.key ?? f.name).join(', '));
  process.exit(0);
}

console.log('=== Stadium field object - own properties ===');
for (const key of Object.getOwnPropertyNames(stadiumField)) {
  if (key === '_parent') continue; // skip, causes circular reference noise
  try {
    const val = stadiumField[key];
    if (typeof val === 'function') {
      console.log(`  ${key}: <function>`);
    } else if (typeof val === 'object' && val !== null) {
      console.log(`  ${key}: <object, keys: ${Object.keys(val).join(', ')}>`);
    } else {
      console.log(`  ${key}: ${JSON.stringify(val)}`);
    }
  } catch (e) {
    console.log(`  ${key}: <error: ${e.message}>`);
  }
}

console.log('\n=== Methods available on its prototype ===');
let proto = Object.getPrototypeOf(stadiumField);
const seen = new Set();
while (proto && proto !== Object.prototype) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || seen.has(name)) continue;
    seen.add(name);
    console.log(`  ${name}`);
  }
  proto = Object.getPrototypeOf(proto);
}
