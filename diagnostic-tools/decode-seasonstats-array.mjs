// Read-only diagnostic - does NOT modify the save.
//
//   node decode-seasonstats-array.mjs "path\to\save" "First" "Last"
//
// Player.SeasonStats[] came back as a raw ~33-bit string, not a parsed
// array - too short to hold embedded data directly, which suggests
// it's a reference/pointer into a separate table (same architecture
// as Stadium all night), not inline data. Checking both: does a
// standalone SeasonStats table actually exist, and does the raw bit
// string decode sensibly as a reference using the same
// tableId(15)+row(17)=32-bit formula confirmed everywhere else tonight.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, firstName, lastName] = process.argv.slice(2);
if (!savePath || !firstName || !lastName) {
  console.error('Usage: node decode-seasonstats-array.mjs <save-path> "<First>" "<Last>"');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('=== Checking for a standalone SeasonStats table ===');
const standalone = franchise.tables.filter(t => t.header.name === 'SeasonStats');
console.log(`Found ${standalone.length} table instance(s) named exactly "SeasonStats".`);
for (const t of standalone) {
  console.log(`  recordCapacity=${t.header.recordCapacity}, tableId=${t.header.tableId}, uniqueId=${t.header.uniqueId}`);
}

console.log('\n=== Finding the player and decoding the raw SeasonStats field ===');
const playerMatches = franchise.tables.filter(t => t.header.name === 'Player');
let targetRec = null, targetTableId = null;
for (const t of playerMatches) {
  await t.readRecords();
  for (let i = 0; i < t.records.length; i++) {
    const rec = t.records[i];
    if (!rec) continue;
    let first, last;
    try { first = rec['FirstName']; last = rec['LastName']; } catch { continue; }
    if (first === firstName && last === lastName) {
      targetRec = rec;
      targetTableId = t.header.tableId;
      console.log(`Found in Player table (tableId=${t.header.tableId}), record index matches.`);
      break;
    }
  }
  if (targetRec) break;
}
if (!targetRec) { console.error('Player not found.'); process.exit(1); }

// Get the raw field object directly, not the parsed value, so we can
// inspect exactly what bits/metadata madden-franchise actually has for
// this field before trying to decode anything ourselves.
const fieldObj = (targetRec._fieldsArray || []).find(f => f._key === 'SeasonStats');
if (!fieldObj) {
  console.log('No field object found for key "SeasonStats" at all.');
} else {
  console.log('\nRaw field object for SeasonStats:');
  console.log('  value:', fieldObj.value);
  console.log('  referenceData:', JSON.stringify(fieldObj.referenceData));
  console.log('  offset (bits):', fieldObj.offset);
  console.log('  length (bits):', fieldObj.length ?? fieldObj.unformattedValue?.length);
  console.log('  all own-property keys:', Object.keys(fieldObj));
}

const raw = fieldObj?.value ?? '';
console.log(`\nRaw bit string: "${raw}" (length ${raw.length})`);

// Try the confirmed tableId(15)+row(17)=32-bit split on the first 32
// bits, same formula used for Stadium/HomeTeam/AwayTeam all session.
if (raw.length >= 32) {
  const bits32 = raw.slice(0, 32);
  const asInt = parseInt(bits32, 2);
  const tableIdGuess = asInt >>> 17;
  const rowGuess = asInt & 0x1FFFF;
  console.log(`\nDecoding first 32 bits as tableId(15)+row(17): tableId=${tableIdGuess}, row=${rowGuess}`);
  const matchingTable = franchise.tables.find(t => t.header.tableId === tableIdGuess);
  console.log('Table with that tableId:', matchingTable ? matchingTable.header.name : '<none found>');
}
