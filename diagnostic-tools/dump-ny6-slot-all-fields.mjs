// Read-only diagnostic - does NOT modify the save.
//
//   node dump-ny6-slot-all-fields.mjs "path\to\save" <record>
//
// The generic Stadium field (offset +4) is confirmed reliable for
// conference championships and regular bowls, but has now been PROVEN
// wrong for native NY6 playoff slots (928-933) - same raw word got a
// different real bowl name in two different seasons, despite the
// person directly watching all 4 games this season and confirming they
// ARE genuinely 6 distinct, correct venues. So presentation for these
// specific slots must be driven by some OTHER field. This dumps every
// field on one record so we can look for it directly instead of
// guessing at more offsets.
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath, recordArg] = process.argv.slice(2);
if (!savePath || !recordArg) {
  console.error('Usage: node dump-ny6-slot-all-fields.mjs <save-path> <record>');
  process.exit(1);
}
const recordIndex = parseInt(recordArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

const rec = seasonGameTable.records[recordIndex];
if (!rec) { console.error(`Record ${recordIndex} is null/empty.`); process.exit(1); }

function getAllFields(r) {
  const out = {};
  for (const f of (r._fieldsArray || [])) {
    try { out[f._key] = r[f._key]; } catch { out[f._key] = '<threw>'; }
  }
  return out;
}

console.log(`All fields on record ${recordIndex}:\n`);
console.log(JSON.stringify(getAllFields(rec), null, 2));
