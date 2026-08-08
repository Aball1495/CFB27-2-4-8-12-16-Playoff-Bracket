// Read-only diagnostic - does NOT modify the save.
//
//   node search-bowl-rotation-tables.mjs "path\to\save" [keyword]
//
// Searches every table name in the franchise for a keyword (default:
// several bowl/rotation/playoff-related terms), to find a table we
// haven't discovered yet that might track which physical stadium hosts
// which NY6 slot each season - separate from any individual game
// record, since BowlGame's own fields turned out to be purely
// positional (sequential IDs matching bracket slot order, not real
// per-bowl identity).
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath, keyword] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node search-bowl-rotation-tables.mjs <save-path> [keyword]');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const keywords = keyword ? [keyword.toLowerCase()] : ['bowl', 'rotation', 'playoff', 'cfp', 'host', 'venue', 'site'];

console.log(`Searching ${franchise.tables.length} total tables for: ${keywords.join(', ')}\n`);
for (const t of franchise.tables) {
  const name = (t.header.name || '').toLowerCase();
  if (keywords.some(k => name.includes(k))) {
    console.log(`"${t.header.name}" tableId=${t.header.tableId} recordCapacity=${t.header.recordCapacity}`);
  }
}
