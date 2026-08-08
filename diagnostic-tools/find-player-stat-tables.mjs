// Read-only diagnostic - does NOT modify the save.
//
//   node find-player-stat-tables.mjs "path\to\save" "First" "Last"
//
// Broader search - checks whether the guessed PlayerStatRecord table
// actually has any populated records at all, and separately scans
// EVERY table with "stat" or "player" in its name for one that
// actually contains this specific player, since the first guess came
// back with zero matches.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, firstName, lastName] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node find-player-stat-tables.mjs <save-path> ["<First>" "<Last>"]');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('=== Checking the guessed PlayerStatRecord table directly ===');
const guessed = franchise.tables.filter(t => t.header.name === 'PlayerStatRecord');
for (const t of guessed) {
  await t.readRecords();
  console.log(`Table instance: recordCapacity=${t.header.recordCapacity}, actual records array length=${t.records.length}`);
  // Show the first non-null record's raw fields, whatever they are
  const firstReal = t.records.find(r => r);
  if (firstReal) {
    const fields = {};
    for (const key of ['firstName', 'lastName', 'calendarYear', 'teamName', 'statType', 'statValue']) {
      try { fields[key] = firstReal[key]; } catch (e) { fields[key] = `<error: ${e.message}>`; }
    }
    console.log('First populated record found:', JSON.stringify(fields));
  } else {
    console.log('No populated records at all in this table instance.');
  }
}

console.log('\n=== Scanning all table names containing "stat" or "player" ===');
const nameSet = new Set();
for (const t of franchise.tables) {
  const name = t.header.name || '';
  if (/stat|player/i.test(name)) nameSet.add(name);
}
console.log([...nameSet].sort().join('\n'));

if (firstName && lastName) {
  console.log(`\n=== Searching all of those tables for ${firstName} ${lastName} ===`);
  for (const name of nameSet) {
    const matches = franchise.tables.filter(t => t.header.name === name);
    for (const t of matches) {
      try {
        await t.readRecords();
      } catch { continue; }
      for (let i = 0; i < t.records.length; i++) {
        const rec = t.records[i];
        if (!rec) continue;
        let first, last;
        try { first = rec['firstName'] ?? rec['FirstName']; last = rec['lastName'] ?? rec['LastName']; } catch { continue; }
        if (first === firstName && last === lastName) {
          console.log(`FOUND in table "${name}", record ${i}`);
        }
      }
    }
  }
}
