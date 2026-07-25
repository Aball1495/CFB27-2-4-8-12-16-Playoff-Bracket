// Read-only diagnostic - does NOT modify the save.
//
//   node find-table-lookup-methods.mjs "path\to\save"
//
// franchise.tables is a pre-loaded snapshot that doesn't contain
// tableId 16434/16437 at all - but those might just not be loaded yet,
// not nonexistent. This inspects the franchise object itself for any
// other way to look up or load a table by ID on demand.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node find-table-lookup-methods.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('=== Methods/properties on the franchise object itself ===\n');
let proto = Object.getPrototypeOf(franchise);
const seen = new Set();
while (proto && proto !== Object.prototype) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || seen.has(name)) continue;
    seen.add(name);
    console.log(`  ${name}`);
  }
  proto = Object.getPrototypeOf(proto);
}

console.log('\n=== Own (non-prototype) properties on franchise ===\n');
for (const key of Object.getOwnPropertyNames(franchise)) {
  const val = franchise[key];
  if (Array.isArray(val)) {
    console.log(`  ${key}: <array, length ${val.length}>`);
  } else if (typeof val === 'object' && val !== null) {
    console.log(`  ${key}: <object, keys: ${Object.keys(val).slice(0, 20).join(', ')}${Object.keys(val).length > 20 ? ', ...' : ''}>`);
  } else if (typeof val === 'function') {
    console.log(`  ${key}: <function>`);
  } else {
    console.log(`  ${key}: ${JSON.stringify(val)}`);
  }
}

console.log('\n=== Total tables actually in franchise.tables ===');
console.log(franchise.tables.length);
console.log('Highest tableId seen:', Math.max(...franchise.tables.map(t => t.header.tableId)));
console.log('Any table with tableId near 16434 (checking 16000-17000 range):');
console.log(franchise.tables.filter(t => t.header.tableId >= 16000 && t.header.tableId <= 17000).map(t => t.header.tableId));
