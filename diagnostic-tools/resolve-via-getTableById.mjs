// Read-only diagnostic - does NOT modify the save.
//
//   node resolve-via-getTableById.mjs "path\to\save"
//
// Bypasses getReferencedRecord entirely (it re-decodes from scratch
// via a separate utility that doesn't want our raw value format) and
// instead uses the field object's own already-correct referenceData
// directly with getTableById - the official lookup method, which
// might lazy-load a table that isn't in the pre-parsed franchise.tables
// snapshot at all.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node resolve-via-getTableById.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('getTableById source:');
console.log(franchise.getTableById.toString().slice(0, 500));
console.log('');

const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

function getFieldObj(rec, key) {
  return (rec._fieldsArray || []).find(f => f._key === key);
}

for (const i of [370, 371]) {
  const rec = seasonTable.records[i];
  const homeField = getFieldObj(rec, 'HomeTeam');
  const stadiumField = getFieldObj(rec, 'Stadium');

  console.log(`\n--- Record ${i} ---`);

  const homeRef = homeField.referenceData;
  console.log(`HomeTeam referenceData: tableId=${homeRef.tableId}, row=${homeRef.rowNumber}`);
  try {
    const homeTable = await franchise.getTableById(homeRef.tableId);
    console.log(`  getTableById(${homeRef.tableId}) succeeded. uniqueId=${homeTable.header.uniqueId} (should be 3359508968, the already-known TEAM_UNIQUE_ID - sanity check this whole approach)`);
    await homeTable.readRecords();
    const homeRec = homeTable.records[homeRef.rowNumber];
    console.log(`  Team record's own fields (first few):`,
      Object.keys(homeRec).filter(k => !k.startsWith('_')).slice(0, 10));
    try { console.log(`  Name-ish field:`, homeRec['Name'] ?? homeRec['DisplayName'] ?? homeRec['TeamName'] ?? '(none of those exist)'); } catch {}
  } catch (e) {
    console.log(`  getTableById(${homeRef.tableId}) threw: ${e.message}`);
  }

  const stadiumRef = stadiumField.referenceData;
  console.log(`Stadium referenceData: tableId=${stadiumRef.tableId}, row=${stadiumRef.rowNumber}`);
  try {
    const stadiumTable = await franchise.getTableById(stadiumRef.tableId);
    if (!stadiumTable) {
      console.log(`  getTableById(${stadiumRef.tableId}) returned nothing.`);
      continue;
    }
    // This is the number that actually matters going forward - tableId
    // drifts across game updates (confirmed: Team's tableId moved from
    // 6334 to 6311 between schema versions while its uniqueId stayed
    // fixed), so whatever we hardcode for future lookups needs to be
    // THIS, not the raw tableId this one save happens to have right now.
    console.log(`  *** STABLE uniqueId for this table: ${stadiumTable.header.uniqueId} (name: "${stadiumTable.header.name}") ***`);
    await stadiumTable.readRecords();
    const stadiumRec = stadiumTable.records[stadiumRef.rowNumber];
    console.log(`  getTableById(${stadiumRef.tableId}) succeeded. Stadium record's own fields:`,
      Object.keys(stadiumRec).filter(k => !k.startsWith('_')).slice(0, 15));
    try { console.log(`  Name field:`, stadiumRec['Name']); } catch (e2) { console.log(`  Name field errored:`, e2.message); }
  } catch (e) {
    console.log(`  getTableById(${stadiumRef.tableId}) threw: ${e.message}`);
  }
}
