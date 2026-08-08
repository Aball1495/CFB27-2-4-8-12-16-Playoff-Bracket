// Read-only diagnostic - does NOT modify the save.
//
//   node map-bowlgame-rows-with-weeks.mjs "path\to\save"
//
// Same as map-bowlgame-rows.mjs but also shows which SeasonWeek each
// referenced SeasonGame record plays in - so we can see which BowlGame
// rows are truly safe to borrow without corrupting a real game playing
// in the same week as our leftover NY6 slots (928-931, week 17-18
// range depending on save).
import path from 'path';
import Franchise from 'madden-franchise';
import { resolveTable, TABLE_UNIQUE_IDS } from './playoffEditorCore.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) { console.error('Usage: node map-bowlgame-rows-with-weeks.mjs <save-path>'); process.exit(1); }
const schemaDirectory = path.join(process.cwd(), 'schemas');

function decodeRef(word) { return { tableId: word >>> 17, row: word & 0x1ffff }; }

const franchise = await Franchise.create(savePath, {
  schemaDirectory,
  schemaOverride: { major: 486, minor: 1, gameYear: 27, path: path.join(schemaDirectory, '486_1.gz') },
});
const seasonGameTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
await seasonGameTable.readRecords();

let bgTableId = null;
for (const rec of seasonGameTable.records) {
  if (!rec) continue;
  let bgStr; try { bgStr = rec['BowlGame']; } catch { continue; }
  const { tableId } = decodeRef(parseInt(bgStr, 2));
  if (tableId) { bgTableId = tableId; break; }
}
const bgTable = franchise.tables.find(t => t.header.tableId === bgTableId);
await bgTable.readRecords();

const bgRowToInfo = new Map();
for (let i = 0; i < seasonGameTable.records.length; i++) {
  const rec = seasonGameTable.records[i];
  if (!rec) continue;
  let bgStr; try { bgStr = rec['BowlGame']; } catch { continue; }
  const { tableId, row } = decodeRef(parseInt(bgStr, 2));
  if (tableId !== bgTableId) continue;
  let week; try { week = rec['SeasonWeek']; } catch { week = '?'; }
  bgRowToInfo.set(row, { seasonGameRecord: i, week });
}

// Show the leftover slot weeks first for context.
const LEFTOVER_SLOTS = [928, 929, 930, 931, 932, 933];
console.log('NY6 leftover slot weeks (for context):');
for (const sgRec of LEFTOVER_SLOTS) {
  const rec = seasonGameTable.records[sgRec];
  if (!rec) continue;
  let week; try { week = rec['SeasonWeek']; } catch { week = '?'; }
  let bgStr; try { bgStr = rec['BowlGame']; } catch { bgStr = null; }
  const { row } = bgStr ? decodeRef(parseInt(bgStr, 2)) : { row: '?' };
  console.log(`  SeasonGame ${sgRec} (BowlGame row ${row}): SeasonWeek=${week}`);
}

console.log('\nFull BowlGame row map with weeks:');
for (let i = 0; i < bgTable.records.length; i++) {
  const bgRec = bgTable.records[i];
  if (!bgRec) { console.log(`  row ${i}: <null>`); continue; }
  let name, isPlayoff; 
  try { name = bgRec['Name']; } catch { name = '?'; }
  try { isPlayoff = bgRec['IsPlayoffBowl']; } catch { isPlayoff = '?'; }
  const info = bgRowToInfo.get(i);
  if (info) {
    console.log(`  row ${i}: "${name}" IsPlayoffBowl=${isPlayoff} | SeasonGame ${info.seasonGameRecord} week=${info.week}`);
  } else {
    console.log(`  row ${i}: "${name}" IsPlayoffBowl=${isPlayoff} | NOT referenced`);
  }
}
