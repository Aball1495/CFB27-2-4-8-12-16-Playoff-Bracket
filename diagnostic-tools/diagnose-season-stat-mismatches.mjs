// Read-only diagnostic - does NOT modify the save.
//
//   node diagnose-season-stat-mismatches.mjs "path\to\save" [maxSamples]
//
// Reproduces correctSeasonStatsToMatchRoster's exact "last populated
// slot" selection logic from main.cjs, but instead of writing anything,
// prints details for the first N players it WOULD flag as mismatched -
// including every candidate season-year-like field it can find on the
// leaf stat record. This is meant to answer one question: is the
// "last populated slot" actually a PAST season's legitimate history
// (expected to differ from current roster), or a genuinely corrupted
// CURRENT-season record?
import path from 'path';
import Franchise from 'madden-franchise';
import { TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath, maxSamplesArg] = process.argv.slice(2);
const maxSamples = parseInt(maxSamplesArg || '15', 10);
if (!savePath) {
  console.error('Usage: node diagnose-season-stat-mismatches.mjs <save-path> [maxSamples]');
  process.exit(1);
}
const schemaDirectory = path.join(process.cwd(), 'schemas');

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});

const teamMatches = franchise.tables.filter(t => t.header.uniqueId === TABLE_UNIQUE_IDS.Team);
const teamTable = teamMatches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
await teamTable.readRecords();
const teamIndexToRow = new Map();
for (let i = 0; i < teamTable.records.length; i++) {
  const rec = teamTable.records[i];
  if (!rec) continue;
  let idx;
  try { idx = rec['TeamIndex']; } catch { continue; }
  if (idx !== undefined) teamIndexToRow.set(idx, i);
}

function getFieldObj(rec, key) { return (rec._fieldsArray || []).find(f => f._key === key); }

const playerTable = franchise.tables.find(t => t.header.name === 'Player');
await playerTable.readRecords();
const containerTable = franchise.tables.find(t => t.header.name === 'SeasonStats[]');
await containerTable.readRecords();
const tableById = new Map();
for (const t of franchise.tables) tableById.set(t.header.tableId, t);
const readTables = new Set();

// Candidate field names that might carry the season year on the leaf
// stat record - tried in order, all reported so we can see which ones
// actually resolve without throwing.
const YEAR_FIELD_CANDIDATES = ['SEAS_YEAR', 'SeasYear', 'SeasonYear', 'CAREER_SEAS_YEAR', 'YEAR'];

function tryReadYearFields(rec) {
  const found = {};
  for (const f of YEAR_FIELD_CANDIDATES) {
    try { found[f] = rec[f]; } catch { /* field doesn't exist on this table, skip */ }
  }
  return found;
}

let checked = 0, mismatched = 0, printed = 0;

for (let i = 0; i < playerTable.records.length && printed < maxSamples; i++) {
  const rec = playerTable.records[i];
  if (!rec) continue;
  let currentTeamIndex;
  try { currentTeamIndex = rec['TeamIndex']; } catch { continue; }
  if (currentTeamIndex === undefined || currentTeamIndex === null) continue;

  const seasonStatsField = getFieldObj(rec, 'SeasonStats');
  const containerRef = seasonStatsField?.referenceData;
  if (!containerRef || containerRef.rowNumber === undefined) continue;
  const containerRec = containerTable.records[containerRef.rowNumber];
  if (!containerRec) continue;

  // Reproduce the exact "last populated slot by array position" logic
  // from main.cjs, but ALSO collect every populated slot (not just the
  // last one) so we can see the full history for context.
  const populatedSlots = [];
  for (let slot = 0; slot < 18; slot++) {
    const slotField = getFieldObj(containerRec, `SeasonStats${slot}`);
    const ref = slotField?.referenceData;
    if (ref && (ref.tableId !== 0 || ref.rowNumber !== 0)) populatedSlots.push({ slot, ref });
  }
  if (populatedSlots.length === 0) continue;
  const lastPopulatedSlotRef = populatedSlots[populatedSlots.length - 1].ref;

  const leafTable = tableById.get(lastPopulatedSlotRef.tableId);
  if (!leafTable) continue;
  if (!readTables.has(leafTable)) { await leafTable.readRecords(); readTables.add(leafTable); }
  const leafRec = leafTable.records[lastPopulatedSlotRef.rowNumber];
  if (!leafRec) continue;

  let statTeamIndex;
  try { statTeamIndex = leafRec['YEARBYYEARTEAMINDEX']; } catch { continue; }
  checked++;

  if (statTeamIndex !== currentTeamIndex) {
    mismatched++;
    const currentRow = teamIndexToRow.get(currentTeamIndex);
    const statRow = teamIndexToRow.get(statTeamIndex);
    const currentTeamName = currentRow !== undefined ? rowToName(currentRow) : `<unresolved TeamIndex ${currentTeamIndex}>`;
    const statTeamName = statRow !== undefined ? rowToName(statRow) : `<unresolved TeamIndex ${statTeamIndex}>`;
    const playerName = (() => { try { return `${rec['FirstName']} ${rec['LastName']}`; } catch { return `<player row ${i}>`; } })();
    const yearFields = tryReadYearFields(leafRec);
    const leafTableName = leafTable.header?.name || `<tableId ${lastPopulatedSlotRef.tableId}>`;

    console.log(`--- ${playerName} (player row ${i}) ---`);
    console.log(`  Current roster team: ${currentTeamName} (TeamIndex ${currentTeamIndex})`);
    console.log(`  All populated slots (${populatedSlots.length} total): ${populatedSlots.map(p => `slot${p.slot}[tableId=${p.ref.tableId},row=${p.ref.rowNumber}]`).join(', ')}`);
    console.log(`  "Last populated slot" used by the correction: slot ${populatedSlots[populatedSlots.length - 1].slot} (table name: ${leafTableName})`);
    console.log(`  That slot's team: ${statTeamName} (TeamIndex ${statTeamIndex})`);
    console.log(`  Candidate year fields found on leaf record: ${JSON.stringify(yearFields)}`);
    console.log('');
    printed++;
  }
}

console.log(`\nChecked ${checked} players, ${mismatched} would be flagged as mismatched by the current logic (sample limited to first ${maxSamples} printed).`);
