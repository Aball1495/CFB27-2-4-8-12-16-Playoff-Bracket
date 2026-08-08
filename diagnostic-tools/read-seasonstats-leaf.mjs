// Read-only diagnostic - does NOT modify the save.
//
//   node read-seasonstats-leaf.mjs "path\to\save"
//
// Following the full chain: Player.SeasonStats -> container row
// (18 slots) -> SeasonStats0 -> tableId=4294, row=1425. This should be
// the actual leaf record holding SEAS_YEAR/TeamPrefixName/
// YEARBYYEARTEAMINDEX for Tayven Jackson's one recorded season.
import path from 'path';
import Franchise from 'madden-franchise';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node read-seasonstats-leaf.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

const table = franchise.tables.find(t => t.header.tableId === 4294);
if (!table) { console.error('Could not find table with tableId 4294.'); process.exit(1); }
console.log(`Table found: name="${table.header.name}", recordCapacity=${table.header.recordCapacity}, uniqueId=${table.header.uniqueId}`);
await table.readRecords();

const rec = table.records[1425];
console.log(`Row 1425: record exists = ${!!rec}`);
if (!rec) process.exit(1);

console.log(`\nAll fields on this record:`);
for (const f of (rec._fieldsArray || [])) {
  console.log(`  key="${f._key}"  value=${JSON.stringify(f.value)}${f.referenceData ? '  referenceData=' + JSON.stringify(f.referenceData) : ''}`);
}

console.log('\nTrying the expected field names directly:');
for (const key of ['SEAS_YEAR', 'TeamPrefixName', 'YEARBYYEARTEAMINDEX', 'GAMESPLAYED']) {
  try { console.log(`  ${key}:`, rec[key]); } catch (e) { console.log(`  ${key}: <error: ${e.message}>`); }
}
try {
  const idx = rec['YEARBYYEARTEAMINDEX'];
  console.log(`\nYEARBYYEARTEAMINDEX (${idx}) resolves to: ${rowToName(idx)}`);
} catch (e) { console.log('Could not resolve:', e.message); }
