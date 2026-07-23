// Read-only diagnostic - does NOT modify the save file at all.
// Run from your project folder (needs node_modules/madden-franchise
// and the schemas/ directory already present there):
//
//   node check-season-year.mjs "C:\path\to\DYNASTY-SAVEFP"
//
import path from 'path';
import Franchise from 'madden-franchise';

const savePath = process.argv[2];
if (!savePath) {
  console.error('Usage: node check-season-year.mjs <path-to-save-file>');
  process.exit(1);
}

const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

// Same uniqueId-based resolution main.cjs already uses - find the real
// SeasonGame table (not a stub) by largest recordCapacity.
const SEASON_GAME_UNIQUE_ID = 4049338978;
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const seasonTable = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await seasonTable.readRecords();

// Sample SeasonYear across a handful of real (non-blank) records rather
// than just record 0, to also confirm it's consistent across games in
// the same season (per the note in playoffEditorCore.mjs that it was
// checked and found identical within one season).
const samples = [];
for (let i = 0; i < seasonTable.records.length && samples.length < 15; i++) {
  const rec = seasonTable.records[i];
  if (!rec) continue;
  let year, status;
  try { year = rec['SeasonYear']; } catch { continue; }
  try { status = rec['GameStatus']; } catch { status = null; }
  samples.push({ record: i, SeasonYear: year, GameStatus: status });
}

console.log('SeasonYear samples (record index, SeasonYear, GameStatus):');
for (const s of samples) console.log(`  record ${s.record}: SeasonYear=${s.SeasonYear}  GameStatus=${s.GameStatus}`);

const uniqueYears = [...new Set(samples.map(s => s.SeasonYear))];
console.log('\nDistinct SeasonYear values seen:', uniqueYears);
