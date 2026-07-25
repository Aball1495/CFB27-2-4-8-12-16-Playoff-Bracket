// Read-only diagnostic - does NOT modify the save.
//
//   node dump-all-seasongame-fields.mjs "path\to\save" <recordIndex>
//
// Dumps EVERY field madden-franchise can enumerate on one SeasonGame
// record, rather than guessing candidate field names ahead of time -
// used to find whatever actually controls displayed venue/location,
// which we don't know the name of yet.
//
// Run this twice: once on a known native CFP slot (try 924 first -
// BRACKET_SLOT_MAPS[16].round1Native[0]) and once on one of the 4
// repurposed bowl games, then compare the two outputs by eye for
// anything location/venue/stadium-sounding that differs.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, recordIndexArg] = process.argv.slice(2);
if (!savePath || recordIndexArg === undefined) {
  console.error('Usage: node dump-all-seasongame-fields.mjs <save-path> <recordIndex>');
  process.exit(1);
}
const recordIndex = parseInt(recordIndexArg, 10);
const schemaDirectory = path.join(process.cwd(), 'schemas');
const SEASON_GAME_UNIQUE_ID = 4049338978;

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});
const matches = franchise.tables.filter(t => t.header.uniqueId === SEASON_GAME_UNIQUE_ID);
const table = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await table.readRecords();

const rec = table.records[recordIndex];
if (!rec) {
  console.error(`No record at index ${recordIndex}`);
  process.exit(1);
}

console.log(`=== Record ${recordIndex} - every field we can enumerate ===\n`);

// Try a few different ways of getting the field list, since we don't
// know which enumeration approach this library actually supports.
let fieldNames = [];
try {
  fieldNames = Object.keys(rec);
  console.log(`(found ${fieldNames.length} fields via Object.keys)`);
} catch (e) {
  console.log('Object.keys failed:', e.message);
}
if (fieldNames.length === 0 && rec.fieldsInfo) {
  try {
    fieldNames = Object.keys(rec.fieldsInfo);
    console.log(`(found ${fieldNames.length} fields via rec.fieldsInfo)`);
  } catch (e) { /* ignore */ }
}
if (fieldNames.length === 0 && table.offsetTable) {
  try {
    fieldNames = Object.keys(table.offsetTable);
    console.log(`(found ${fieldNames.length} fields via table.offsetTable)`);
  } catch (e) { /* ignore */ }
}

if (fieldNames.length === 0) {
  console.log('Could not enumerate fields automatically. Trying a manual fallback list instead...');
  fieldNames = [
    'Stadium', 'StadiumRef', 'Venue', 'VenueRef', 'Location', 'LocationName',
    'City', 'CityName', 'HomeStadium', 'NeutralSite', 'IsNeutralSite',
    'SiteType', 'GameSite', 'HostStadium',
  ];
}

for (const key of fieldNames.sort()) {
  try {
    console.log(`  ${key}: ${JSON.stringify(rec[key])}`);
  } catch (e) {
    console.log(`  ${key}: <error: ${e.message}>`);
  }
}
