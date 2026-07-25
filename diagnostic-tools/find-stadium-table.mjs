// Read-only diagnostic - does NOT modify the save.
//
//   node find-stadium-table.mjs "path\to\save"
//
// Lists every table franchise.tables knows about whose name looks
// Stadium-related, with its tableId/uniqueId/recordCapacity - we need
// this to find the real uniqueId (tableId drifts, uniqueId doesn't,
// same pattern as every other table this session), and to check
// whether "Stadium" is a single table or split across several real
// shards (as opposed to one real table + empty stubs, which is what
// SeasonGame/BowlGame turned out to be).
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node find-stadium-table.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('All tables with "Stadium" in the name:\n');
for (const t of franchise.tables) {
  const name = t.header?.name ?? t.name ?? '';
  if (typeof name === 'string' && name.toLowerCase().includes('stadium')) {
    console.log(`  name="${name}"  tableId=${t.header.tableId}  uniqueId=${t.header.uniqueId}  recordCapacity=${t.header.recordCapacity}`);
  }
}

console.log('\nSpecifically checking the 3 tableIds we saw in decoded references (16434, 16435, 16437):\n');
for (const targetId of [16434, 16435, 16437]) {
  const t = franchise.tables.find(tt => tt.header.tableId === targetId);
  if (!t) {
    console.log(`  tableId ${targetId}: NOT FOUND in franchise.tables`);
    continue;
  }
  const name = t.header?.name ?? t.name ?? '(no name field)';
  console.log(`  tableId ${targetId}: name="${name}"  uniqueId=${t.header.uniqueId}  recordCapacity=${t.header.recordCapacity}`);
}
