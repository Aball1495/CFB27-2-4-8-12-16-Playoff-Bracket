// Read-only diagnostic - does NOT modify either save.
//
//   node compare-bowlgame-fields-cross-save.mjs <nativeSavePath> <nativeRecord> <modifiedSavePath> <modifiedRecord>
//
// Same field comparison as compare-bowlgame-fields.mjs, but across TWO
// different save files - specifically for comparing a native, never-
// touched instance of a real NY6 bowl (e.g. a save from earlier in this
// project, before we ever wrote to these slots, where the game natively
// assigned Sugar/Rose/Peach/Orange on its own) against our own modified
// slot showing the orange-field glitch. If even the native, untouched
// presentation differs meaningfully from a real dedicated-stadium bowl
// (like a regular bowl), that points toward the glitch being inherent to
// the shared-NFL-venue stadium asset itself, not something our writes
// introduced.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [nativeSavePath, nativeRecordArg, modifiedSavePath, modifiedRecordArg] = process.argv.slice(2);
if (!nativeSavePath || !nativeRecordArg || !modifiedSavePath || !modifiedRecordArg) {
  console.error('Usage: node compare-bowlgame-fields-cross-save.mjs <nativeSavePath> <nativeRecord> <modifiedSavePath> <modifiedRecord>');
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

async function getBowlGameFields(savePath, seasonRecordIndex) {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
  });
  const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  await seasonGameTable.readRecords();
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

const nativeFields = await getBowlGameFields(nativeSavePath, parseInt(nativeRecordArg, 10));
const modifiedFields = await getBowlGameFields(modifiedSavePath, parseInt(modifiedRecordArg, 10));

console.log(`--- Native/untouched record ${nativeRecordArg} (${nativeSavePath}) ---`);
console.log(JSON.stringify(nativeFields, null, 2));
console.log(`\n--- Modified record ${modifiedRecordArg} (${modifiedSavePath}) ---`);
console.log(JSON.stringify(modifiedFields, null, 2));

console.log('\n--- Fields that differ ---');
const allKeys = new Set([...Object.keys(nativeFields || {}), ...Object.keys(modifiedFields || {})]);
for (const key of allKeys) {
  const n = nativeFields?.[key];
  const m = modifiedFields?.[key];
  if (JSON.stringify(n) !== JSON.stringify(m)) {
    console.log(`  ${key}: native="${n}" vs modified="${m}"`);
  }
}
