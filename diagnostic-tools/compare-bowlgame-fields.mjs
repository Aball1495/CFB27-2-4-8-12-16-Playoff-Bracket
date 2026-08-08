// Read-only diagnostic - does NOT modify the save.
//
//   node compare-bowlgame-fields.mjs "path\to\save" <workingSeasonGameRecord> <modifiedSeasonGameRecord>
//
// Dumps the full BowlGame sub-record fields for two SeasonGame records
// side by side, to find exactly which field(s) differ - e.g. compare a
// known-correctly-rendering regular bowl (like the Gator Bowl, record
// 395) against an NY6 leftover slot that was just modified via
// assignRealBowlsToLeftoverSlots, to find what's missing/wrong (like an
// "orange field" report suggesting a missed field-appearance flag).
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, workingRecordArg, modifiedRecordArg] = process.argv.slice(2);
if (!savePath || !workingRecordArg || !modifiedRecordArg) {
  console.error('Usage: node compare-bowlgame-fields.mjs <save-path> <workingRecord> <modifiedRecord>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }
function getAllFields(rec) {
  const out = {};
  for (const f of (rec._fieldsArray || [])) {
    try { out[f._key] = rec[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

async function getBowlGameFields(seasonRecordIndex) {
  const rec = seasonGameTable.records[seasonRecordIndex];
  if (!rec) return null;
  let bowlGameStr;
  try { bowlGameStr = rec['BowlGame']; } catch { return null; }
  const decoded = decodeRef(parseInt(bowlGameStr, 2));
  const bowlGameTable = franchise.tables.find(t => t.header.tableId === decoded.tableId);
  if (!bowlGameTable) return null;
  await bowlGameTable.readRecords();
  const bgRec = bowlGameTable.records[decoded.row];
  if (!bgRec) return null;
  return getAllFields(bgRec);
}

const workingFields = await getBowlGameFields(parseInt(workingRecordArg, 10));
const modifiedFields = await getBowlGameFields(parseInt(modifiedRecordArg, 10));

console.log(`--- Working record ${workingRecordArg}'s BowlGame fields ---`);
console.log(JSON.stringify(workingFields, null, 2));
console.log(`\n--- Modified record ${modifiedRecordArg}'s BowlGame fields ---`);
console.log(JSON.stringify(modifiedFields, null, 2));

console.log('\n--- Fields that differ ---');
const allKeys = new Set([...Object.keys(workingFields || {}), ...Object.keys(modifiedFields || {})]);
for (const key of allKeys) {
  const w = workingFields?.[key];
  const m = modifiedFields?.[key];
  if (JSON.stringify(w) !== JSON.stringify(m)) {
    console.log(`  ${key}: working="${w}" vs modified="${m}"`);
  }
}
