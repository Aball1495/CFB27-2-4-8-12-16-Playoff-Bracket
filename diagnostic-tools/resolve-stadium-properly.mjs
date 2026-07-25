// Read-only diagnostic - does NOT modify the save.
//
//   node resolve-stadium-properly.mjs "path\to\save"
//
// Uses the library's own referenceData/value accessors on the Stadium
// field object directly, instead of our own hand-decoded bit-guessing.
// Checks the same records as before (370, 371, 924, 925) so we can
// directly compare against the earlier (wrong) results.
import path from 'path';
import Franchise from 'madden-franchise';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node resolve-stadium-properly.mjs <save-path>');
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

function describeReference(fieldObj) {
  if (!fieldObj) return '(field not found)';
  let refData = null, val = null;
  try { refData = fieldObj.referenceData; } catch (e) { refData = `<error: ${e.message}>`; }
  try { val = fieldObj.value; } catch (e) { val = `<error: ${e.message}>`; }
  return { referenceData: refData, value: val };
}

for (const i of [370, 371, 924, 925]) {
  const rec = seasonTable.records[i];
  if (!rec) { console.log(`Record ${i}: no record`); continue; }

  const homeField = getFieldObj(rec, 'HomeTeam');
  const stadiumField = getFieldObj(rec, 'Stadium');

  console.log(`Record ${i}:`);
  console.log('  HomeTeam ->', JSON.stringify(describeReference(homeField)));
  console.log('  Stadium  ->', JSON.stringify(describeReference(stadiumField)));

  // If referenceData gives us a real table+row, try to read the
  // Stadium record's own Name field directly from whichever table
  // referenceData says it's actually in.
  const refData = stadiumField ? stadiumField.referenceData : null;
  if (refData && refData.tableId !== undefined) {
    const targetTable = franchise.tables.find(t => t.header.tableId === refData.tableId);
    if (targetTable) {
      await targetTable.readRecords();
      const targetRec = targetTable.records[refData.rowNumber ?? refData.row];
      let stadiumName = null;
      try { stadiumName = targetRec ? targetRec['Name'] : null; } catch { /* ignore */ }
      console.log(`  Resolved stadium table name="${targetTable.header.name}", record Name field="${stadiumName}"`);
    } else {
      console.log(`  referenceData pointed at tableId ${refData.tableId}, but no such table exists in franchise.tables`);
    }
  }
  console.log('');
}
