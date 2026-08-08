// Read-only diagnostic - does NOT modify the save.
//
//   node map-bowlgame-rows.mjs "path\to\save"
//
// Maps which BowlGame rows are currently referenced by which SeasonGame
// records, to find free/unused rows we can safely commandeer for the
// NY6 leftover slot fix - write real bowl branding into them, then
// point the leftover slots' own BowlGame reference at those rows
// instead of the native CFP rows (12-17).
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) { console.error('Usage: node map-bowlgame-rows.mjs <save-path>'); process.exit(1); }
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

// Find the BowlGame table and its capacity.
let bgTableId = null;
for (const rec of seasonGameTable.records) {
  if (!rec) continue;
  let bgStr;
  try { bgStr = rec['BowlGame']; } catch { continue; }
  const { tableId } = decodeRef(parseInt(bgStr, 2));
  if (tableId) { bgTableId = tableId; break; }
}
const bgTable = franchise.tables.find(t => t.header.tableId === bgTableId);
console.log(`BowlGame table: tableId=${bgTableId} name="${bgTable?.header?.name}" recordCapacity=${bgTable?.header?.recordCapacity}\n`);
await bgTable.readRecords();

// Build a map of which rows are referenced.
const rowToSeasonGameRecords = new Map();
for (let i = 0; i < seasonGameTable.records.length; i++) {
  const rec = seasonGameTable.records[i];
  if (!rec) continue;
  let bgStr;
  try { bgStr = rec['BowlGame']; } catch { continue; }
  const { tableId, row } = decodeRef(parseInt(bgStr, 2));
  if (tableId !== bgTableId) continue;
  if (!rowToSeasonGameRecords.has(row)) rowToSeasonGameRecords.set(row, []);
  rowToSeasonGameRecords.get(row).push(i);
}

// Print every BowlGame row with its name, IsPlayoffBowl, and which
// SeasonGame records reference it.
console.log('BowlGame row map:');
for (let i = 0; i < bgTable.records.length; i++) {
  const rec = bgTable.records[i];
  if (!rec) { console.log(`  row ${i}: <null>`); continue; }
  let name, isPlayoff;
  try { name = rec['Name']; } catch { name = '?'; }
  try { isPlayoff = rec['IsPlayoffBowl']; } catch { isPlayoff = '?'; }
  const refs = rowToSeasonGameRecords.get(i) || [];
  const refStr = refs.length ? `referenced by SeasonGame records: ${refs.join(', ')}` : 'NOT referenced by any SeasonGame record';
  console.log(`  row ${i}: Name="${name}" IsPlayoffBowl=${isPlayoff} | ${refStr}`);
}

// Summarize free rows.
const freeRows = [];
for (let i = 0; i < bgTable.records.length; i++) {
  if (!rowToSeasonGameRecords.has(i)) freeRows.push(i);
}
console.log(`\nFree rows (not referenced by any SeasonGame): ${freeRows.join(', ')}`);
