// Read-only diagnostic - does NOT modify the save.
//
//   node dump-neutral-stadium-table.mjs "path\to\save"
//
// Dumps every record in ScheduleNeutralStadium (73 rows) - a promising
// lead for real venue names, since the table literally named "Stadium"
// turned out to be entirely vestigial/blank in this save, and this
// table's name matches the concept of NFL-stadium neutral-site CFB
// games (season openers, kickoff classics) exactly.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-neutral-stadium-table.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const table = franchise.tables.find(t => t.header.name === 'ScheduleNeutralStadium');
if (!table) {
  console.error('Could not find a table named "ScheduleNeutralStadium".');
  process.exit(1);
}
console.log(`Found ScheduleNeutralStadium (tableId=${table.header.tableId}, recordCapacity=${table.header.recordCapacity})`);
await table.readRecords();

function getAllFields(rec) {
  const out = {};
  for (const f of (rec._fieldsArray || [])) {
    try { out[f._key] = rec[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

console.log(`\nDumping first 5 records' full fields:\n`);
let shown = 0;
for (let i = 0; i < table.records.length && shown < 5; i++) {
  const rec = table.records[i];
  if (!rec) { console.log(`row ${i}: <null>`); continue; }
  console.log(`--- row ${i} ---`);
  console.log(JSON.stringify(getAllFields(rec), null, 2));
  console.log('');
  shown++;
}
