// Read-only diagnostic - does NOT modify the save.
//
//   node dump-playoff-bowls-info.mjs "path\to\save"
//
// Dumps all records of PlayoffBowlsInfo (tableId 4125, recordCapacity
// 6) - the record count exactly matches the 6 NY6 bowls, making this a
// strong candidate for the real, stable per-bowl identity table we've
// been missing (BowlGame's own fields turned out to be purely
// positional/sequential, not real identity).
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-playoff-bowls-info.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const table = franchise.tables.find(t => t.header.tableId === 4125 && t.header.name === 'PlayoffBowlsInfo');
if (!table) {
  console.error('Could not find PlayoffBowlsInfo (tableId 4125).');
  process.exit(1);
}
console.log(`Found PlayoffBowlsInfo (recordCapacity=${table.header.recordCapacity})\n`);
await table.readRecords();

function getAllFields(r) {
  const out = {};
  for (const f of (r._fieldsArray || [])) {
    try { out[f._key] = r[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

for (let i = 0; i < table.records.length; i++) {
  const rec = table.records[i];
  if (!rec) { console.log(`--- row ${i}: null ---\n`); continue; }
  console.log(`--- row ${i} ---`);
  console.log(JSON.stringify(getAllFields(rec), null, 2));
  console.log('');
}
