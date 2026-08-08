// Read-only diagnostic - does NOT modify the save.
//
//   node dump-seasonstats-raw.mjs "path\to\save"
//
// All field reads by guessed key name came back null for row 5181 -
// dumping the actual raw field list to see real key names/values
// rather than guessing again.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-seasonstats-raw.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const table = franchise.tables.find(t => t.header.tableId === 6349);
await table.readRecords();

for (const row of [5181]) {
  const rec = table.records[row];
  console.log(`Row ${row}: record exists = ${!!rec}`);
  if (!rec) continue;
  const fields = rec._fieldsArray || [];
  console.log(`Number of fields on this record: ${fields.length}`);
  for (const f of fields) {
    console.log(`  key="${f._key}"  value=${JSON.stringify(f.value)}  referenceData=${JSON.stringify(f.referenceData)}`);
  }
}
