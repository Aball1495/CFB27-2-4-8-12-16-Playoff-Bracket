// Read-only diagnostic - does NOT modify the save.
//
//   node decode-neutral-stadium-refs.mjs "path\to\save"
//
// Decodes Team1, Team2, and Stadium on every ScheduleNeutralStadium
// record using the standard 15-bit-tableId + 17-bit-row format. Team1/
// Team2 SHOULD decode to tableId 6339 (the confirmed real Team table) -
// if Stadium decodes to something wildly different and not present in
// franchise.tables (like the 16000s range seen earlier), that confirms
// stadium references use a different encoding entirely (very likely a
// reference into the game's static/hardcoded asset catalog, not a row
// in any save-file table we can enumerate).
import path from 'path';
import Franchise from 'madden-franchise';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node decode-neutral-stadium-refs.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const teamTable = franchise.tables.find(t => t.header.name === 'Team');
await teamTable.readRecords();

const nsTable = franchise.tables.find(t => t.header.name === 'ScheduleNeutralStadium');
await nsTable.readRecords();

const tableIdsPresent = new Set(franchise.tables.map(t => t.header.tableId));

console.log(`Team table tableId (known-good, for comparison): ${teamTable.header.tableId}\n`);

for (let i = 0; i < Math.min(10, nsTable.records.length); i++) {
  const rec = nsTable.records[i];
  if (!rec) continue;
  const t1 = rec['Team1'], t2 = rec['Team2'], st = rec['Stadium'];
  if (!t1 || !t2 || !st) continue;
  const t1d = decodeRef(parseInt(t1, 2));
  const t2d = decodeRef(parseInt(t2, 2));
  const std = decodeRef(parseInt(st, 2));
  let t1Name = '?', t2Name = '?';
  try { t1Name = teamTable.records[t1d.row]?.['TEAM_PREFIX_NAME']; } catch {}
  try { t2Name = teamTable.records[t2d.row]?.['TEAM_PREFIX_NAME']; } catch {}
  console.log(`--- row ${i} ---`);
  console.log(`  Team1 -> tableId=${t1d.row !== undefined ? t1d.tableId : '?'} row=${t1d.row} (${tableIdsPresent.has(t1d.tableId) ? 'table exists' : 'NO SUCH TABLE'}) -> TEAM_PREFIX_NAME="${t1Name}"`);
  console.log(`  Team2 -> tableId=${t2d.tableId} row=${t2d.row} (${tableIdsPresent.has(t2d.tableId) ? 'table exists' : 'NO SUCH TABLE'}) -> TEAM_PREFIX_NAME="${t2Name}"`);
  console.log(`  Stadium -> tableId=${std.tableId} row=${std.row} (${tableIdsPresent.has(std.tableId) ? 'table exists' : 'NO SUCH TABLE'})`);
}
