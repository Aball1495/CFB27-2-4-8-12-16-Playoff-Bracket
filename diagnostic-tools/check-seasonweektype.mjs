// Read-only diagnostic - does NOT modify the save.
//
//   node check-seasonweektype.mjs "path\to\save"
//
// Checks SeasonWeekType (schema-readable enum) for Georgia's specific
// problem records - testing whether this field correctly identifies
// bowl vs regular-season games even when the raw week NUMBER is
// corrupted/mislabeled by the recycled-slot issue confirmed tonight.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-seasonweektype.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const matches = franchise.tables.filter(t => t.header.name === 'SeasonGame');
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
console.log(`Using SeasonGame table instance with recordCapacity=${table.header.recordCapacity} (found ${matches.length} instance(s) total)`);
await table.readRecords();

// Record 94 (Georgia @ UCF, tool said week=16, real week=10) and
// record 400 (TCU @ Georgia, tool said week=4, real = Bowl Week 2) -
// the two specific problem cases - plus a couple of correctly-placed
// ones for comparison (563 Mississippi State, 417 Clemson).
const checkRecords = [
  { record: 94, label: 'Georgia @ UCF (real: Week 10, regular season)' },
  { record: 400, label: 'TCU @ Georgia (real: Bowl Week 2)' },
  { record: 563, label: 'Mississippi State @ Georgia (real: Week 11, regular season)' },
  { record: 417, label: 'Georgia @ Clemson (real: Week 1, regular season)' },
];

for (const { record, label } of checkRecords) {
  const rec = table.records[record];
  if (!rec) { console.log(`Record ${record}: no record found`); continue; }
  let weekType, week;
  try { weekType = rec['SeasonWeekType']; } catch (e) { weekType = `<error: ${e.message}>`; }
  try { week = rec['SeasonWeek']; } catch (e) { week = `<error: ${e.message}>`; }
  console.log(`Record ${record} (${label}):`);
  console.log(`  SeasonWeekType = ${weekType}`);
  console.log(`  SeasonWeek (raw schema value) = ${week}`);
  console.log('');
}
