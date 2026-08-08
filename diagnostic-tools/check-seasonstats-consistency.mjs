// Read-only diagnostic - does NOT modify the save.
//
//   node check-seasonstats-consistency.mjs "path\to\save"
//
// Full-roster sweep: for every player, follows the confirmed chain
// (Player.SeasonStats -> 18-slot container row -> each populated leaf
// SeasonOffensiveStats-type record) and checks whether the MOST RECENT
// season-stat entry's team (TeamPrefixName / YEARBYYEARTEAMINDEX)
// matches the player's CURRENT team (via Player.TeamIndex, resolved
// through Team.TeamIndex - NOT row position, confirmed tonight these
// are different numbering systems).
//
// Run this on a save BEFORE running the Playoff Bracket Tool, and
// again on a save from AFTER, at the same point in the season if
// possible - if the mismatch count/pattern is already present before
// the tool ever touches the file, that's decisive evidence against
// writeMatchup() being the cause. If it only appears after, that
// points squarely at it.
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS, resolveTable } from './playoffEditorCore.mjs';
import { rowToName, teamRow } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node check-seasonstats-consistency.mjs <save-path>');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
});

console.log('Loading Team table and building TeamIndex -> name map...');
const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
await teamTable.readRecords();
const teamIndexToName = new Map();
for (let i = 0; i < teamTable.records.length; i++) {
  const rec = teamTable.records[i];
  if (!rec) continue;
  let idx, name;
  try { idx = rec['TeamIndex']; } catch { continue; }
  try { name = rowToName(i); } catch { continue; }
  if (idx !== undefined && name) teamIndexToName.set(idx, name);
}
console.log(`Mapped ${teamIndexToName.size} teams by TeamIndex.\n`);

function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }

console.log('Loading Player table...');
const playerTable = franchise.tables.find(t => t.header.name === 'Player');
await playerTable.readRecords();
console.log(`${playerTable.records.length} player records to check.\n`);

// The "SeasonStats[]" container table (confirmed tableId 6349 tonight,
// but resolve by name to stay robust across saves/schema versions).
const containerTable = franchise.tables.find(t => t.header.name === 'SeasonStats[]');
await containerTable.readRecords();

const mismatchPairs = new Map(); // "wrongTeam -> correctTeam" -> count
const mismatchSamples = [];
let checked = 0, skippedNoData = 0, mismatchCount = 0;
const tableById = new Map();
for (const t of franchise.tables) tableById.set(t.header.tableId, t);
const readTables = new Set();

for (let i = 0; i < playerTable.records.length; i++) {
  const rec = playerTable.records[i];
  if (!rec) continue;
  let currentTeamIndex, firstName, lastName;
  try { currentTeamIndex = rec['TeamIndex']; } catch { continue; }
  if (currentTeamIndex === undefined || currentTeamIndex === null) { skippedNoData++; continue; }
  try { firstName = rec['FirstName']; lastName = rec['LastName']; } catch { firstName = '?'; lastName = '?'; }

  const seasonStatsField = getFieldObj(rec, 'SeasonStats');
  const containerRef = seasonStatsField?.referenceData;
  if (!containerRef || containerRef.rowNumber === undefined) { skippedNoData++; continue; }
  const containerRec = containerTable.records[containerRef.rowNumber];
  if (!containerRec) { skippedNoData++; continue; }

  // Find the LAST populated slot (0-17) - treating it as "most recent
  // season" on the assumption slots fill in order. Not verified against
  // an explicit ordering field, so treat this as a reasonable
  // approximation, not a certainty.
  let lastPopulatedSlotRef = null;
  for (let slot = 0; slot < 18; slot++) {
    const slotField = getFieldObj(containerRec, `SeasonStats${slot}`);
    const ref = slotField?.referenceData;
    if (ref && (ref.tableId !== 0 || ref.rowNumber !== 0)) lastPopulatedSlotRef = ref;
  }
  if (!lastPopulatedSlotRef) { skippedNoData++; continue; }

  const leafTable = tableById.get(lastPopulatedSlotRef.tableId);
  if (!leafTable) { skippedNoData++; continue; }
  if (!readTables.has(leafTable)) { await leafTable.readRecords(); readTables.add(leafTable); }
  const leafRec = leafTable.records[lastPopulatedSlotRef.rowNumber];
  if (!leafRec) { skippedNoData++; continue; }

  let statTeamIndex;
  try { statTeamIndex = leafRec['YEARBYYEARTEAMINDEX']; } catch { skippedNoData++; continue; }

  checked++;
  if (statTeamIndex !== currentTeamIndex) {
    mismatchCount++;
    const wrongName = teamIndexToName.get(statTeamIndex) || `<TeamIndex ${statTeamIndex}>`;
    const correctName = teamIndexToName.get(currentTeamIndex) || `<TeamIndex ${currentTeamIndex}>`;
    const pairKey = `${wrongName} -> ${correctName}`;
    mismatchPairs.set(pairKey, (mismatchPairs.get(pairKey) || 0) + 1);
    if (mismatchSamples.length < 15) {
      mismatchSamples.push(`${firstName} ${lastName}: stat says ${wrongName}, roster says ${correctName}`);
    }
  }
}

console.log(`=== RESULTS ===`);
console.log(`Checked: ${checked}, skipped (no usable data): ${skippedNoData}, mismatches: ${mismatchCount}`);
console.log(`Mismatch rate: ${checked > 0 ? ((mismatchCount / checked) * 100).toFixed(1) : 0}%\n`);

console.log('Mismatch pairs (wrong -> correct), sorted by count:');
const sortedPairs = [...mismatchPairs.entries()].sort((a, b) => b[1] - a[1]);
for (const [pair, count] of sortedPairs.slice(0, 20)) {
  console.log(`  ${count}x  ${pair}`);
}

console.log('\nSample mismatches:');
for (const s of mismatchSamples) console.log(`  ${s}`);
