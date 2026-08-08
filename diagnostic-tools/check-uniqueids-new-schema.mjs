// Read-only diagnostic - does NOT modify the save.
//
//   node check-uniqueids-new-schema.mjs "path\to\DYNASTY-HHF"
//
// Confirms whether table uniqueIds actually held stable in a save
// built by the updated game (486.1) - something the schema file alone
// could never tell us, since uniqueId lives in the save's own table
// headers, not in the schema definition.
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-uniqueids-new-schema.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const EXPECTED = {
  Team: 3359508968,
  SeasonGame: 4049338978,
  Coach: 1860529246,
  BowlGame: 902037496,
  ScheduleStructure: 1641852314,
};

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

console.log('=== uniqueId check against the save itself (not the schema file) ===\n');
for (const [name, expectedId] of Object.entries(EXPECTED)) {
  const matches = franchise.tables.filter(t => t.header.name === name);
  if (!matches.length) {
    console.log(`${name}: *** NO TABLE FOUND BY THIS NAME ***`);
    continue;
  }
  const real = matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  const actualId = real.header.uniqueId;
  const status = actualId === expectedId ? 'OK' : '*** MISMATCH ***';
  console.log(`${name}: expected=${expectedId}, actual=${actualId}  ${status}`);
}

console.log('\n=== Confirming the save actually opened/parsed correctly with the new schema ===');
console.log(`Total tables loaded: ${franchise.tables.length}`);
