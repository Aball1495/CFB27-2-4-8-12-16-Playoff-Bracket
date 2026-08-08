// Read-only diagnostic - does NOT modify the save.
//
//   node dump-stadium-table.mjs "path\to\save" [searchTerm]
//
// Enumerates the Stadium table. With no searchTerm, dumps every field on
// the first 5 records (so we can identify which field holds the display
// name). With a searchTerm, scans every record's fields for a case-
// insensitive text match and prints just the matches - use this to find
// each of the 20 target venues by name once we know the right field.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, searchTerm] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node dump-stadium-table.mjs <save-path> [searchTerm]');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

// Try a few likely table names - not sure yet which one the schema uses.
const candidates = ['Stadium', 'Stadium[]', 'StadiumInfo', 'TeamStadium'];
let stadiumTable = null;
for (const name of candidates) {
  const t = franchise.tables.find(x => x.header.name === name);
  if (t) { stadiumTable = t; console.log(`Found table by name "${name}" (tableId=${t.header.tableId}, recordCapacity=${t.header.recordCapacity})`); break; }
}
if (!stadiumTable) {
  // Fall back: list every table whose name contains "stadium" (case-insensitive)
  const matches = franchise.tables.filter(t => (t.header.name || '').toLowerCase().includes('stadium'));
  console.log(`No exact match on ${candidates.join(', ')}. Tables with "stadium" in the name:`);
  matches.forEach(t => console.log(`  "${t.header.name}" (tableId=${t.header.tableId}, recordCapacity=${t.header.recordCapacity})`));
  process.exit(0);
}

await stadiumTable.readRecords();

function getAllFields(rec) {
  const out = {};
  for (const f of (rec._fieldsArray || [])) {
    try { out[f._key] = rec[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

if (!searchTerm) {
  console.log(`\n${stadiumTable.records.length} total records. Dumping first 5 non-empty records' fields:\n`);
  let shown = 0;
  for (let i = 0; i < stadiumTable.records.length && shown < 5; i++) {
    const rec = stadiumTable.records[i];
    if (!rec) continue;
    console.log(`--- row ${i} ---`);
    console.log(JSON.stringify(getAllFields(rec), null, 2));
    console.log('');
    shown++;
  }
} else if (searchTerm === '--all') {
  // Dump a compact view of every row's most-likely identity fields,
  // so we can see which field(s) actually vary across the table at
  // all, rather than guessing one field name at a time.
  console.log(`\nCompact dump of all ${stadiumTable.records.length} records:\n`);
  for (let i = 0; i < stadiumTable.records.length; i++) {
    const rec = stadiumTable.records[i];
    if (!rec) { console.log(`row ${i}: <null record>`); continue; }
    const fields = getAllFields(rec);
    console.log(`row ${i}: AssetName="${fields.STADIUM_ASSETNAME}" PresentationId=${fields.PresentationId} Icon="${fields.STADIUM_ICON}" Type="${fields.Type}" Size=${fields.Size} Name="${fields.Name}"`);
  }
} else if (searchTerm === '--real') {
  // Name/NickName/DisplayName can be blank even on real stadiums - use
  // capacity as a proxy for "this slot is actually in use" instead,
  // since an empty/unused slot has 0 capacity.
  console.log(`\nScanning ${stadiumTable.records.length} records for STADIUM_CAPACITY > 0...\n`);
  let found = 0;
  for (let i = 0; i < stadiumTable.records.length; i++) {
    const rec = stadiumTable.records[i];
    if (!rec) continue;
    let capacity;
    try { capacity = rec['STADIUM_CAPACITY']; } catch { continue; }
    if (!capacity) continue;
    const fields = getAllFields(rec);
    console.log(`--- row ${i} (capacity ${capacity}) ---`);
    console.log(JSON.stringify({
      Name: fields.Name, NickName: fields.NickName, STADIUM_DISPLAYNAME: fields.STADIUM_DISPLAYNAME,
      STADIUM_ASSETNAME: fields.STADIUM_ASSETNAME, PresentationId: fields.PresentationId,
      STADIUM_ICON: fields.STADIUM_ICON, City: fields.City, STADIUM_CAPACITY: fields.STADIUM_CAPACITY,
    }, null, 2));
    found++;
  }
  console.log(`\n${found} record(s) with nonzero capacity found.`);
} else {
  const needle = searchTerm.toLowerCase();
  console.log(`\nSearching ${stadiumTable.records.length} records for "${searchTerm}"...\n`);
  let found = 0;
  for (let i = 0; i < stadiumTable.records.length; i++) {
    const rec = stadiumTable.records[i];
    if (!rec) continue;
    const fields = getAllFields(rec);
    const hit = Object.entries(fields).some(([k, v]) => typeof v === 'string' && v.toLowerCase().includes(needle));
    if (hit) {
      console.log(`--- row ${i} ---`);
      console.log(JSON.stringify(fields, null, 2));
      console.log('');
      found++;
    }
  }
  console.log(`${found} matching record(s) found.`);
}
