#!/usr/bin/env node
/**
 * Diagnostic: for every one of the 32 regular bowls, read its BowlGame
 * definition row's scheduling fields (DaysOffset, GameTime, RelativeAppt)
 * so we can find 4 whose real calendar slots are naturally back-to-back
 * and don't collide with each other or anything else - instead of
 * guessing at which 4 to repurpose for a clean, uninterrupted block of 8
 * CFP First Round games.
 *
 * Usage:
 *   node diagnose-bowl-schedule.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-bowl-schedule.mjs "<path to save>"');
  process.exit(1);
}

// Same REGULAR_BOWLS list as playoffEditorCore.mjs
const REGULAR_BOWLS = [
  { name: 'Xbox Bowl', record: 369 }, { name: 'Cure Bowl', record: 370 },
  { name: 'Boca Raton Bowl', record: 371 }, { name: 'New Mexico Bowl', record: 372 },
  { name: 'Independence Bowl', record: 373 }, { name: '68 Ventures Bowl', record: 374 },
  { name: 'New Orleans Bowl', record: 375 }, { name: 'Myrtle Beach Bowl', record: 376 },
  { name: 'Famous Idaho Potato Bowl', record: 377 }, { name: 'Frisco Bowl', record: 378 },
  { name: 'Armed Forces Bowl', record: 379 }, { name: 'Gasparilla Bowl', record: 380 },
  { name: 'Hawaii Bowl', record: 381 }, { name: 'Salute to Veterans Bowl', record: 382 },
  { name: 'Military Bowl', record: 383 }, { name: 'Birmingham Bowl', record: 384 },
  { name: 'First Responder Bowl', record: 385 }, { name: 'Liberty Bowl', record: 386 },
  { name: 'Holiday Bowl', record: 387 }, { name: 'Rate Bowl', record: 388 },
  { name: 'Fenway Bowl', record: 389 }, { name: 'Pop-Tarts Bowl', record: 390 },
  { name: 'Alamo Bowl', record: 391 }, { name: "Duke's Mayo Bowl", record: 392 },
  { name: 'Music City Bowl', record: 393 }, { name: 'Las Vegas Bowl', record: 394 },
  { name: 'Gator Bowl', record: 395 }, { name: 'Sun Bowl', record: 396 },
  { name: 'Arizona Bowl', record: 397 }, { name: 'Reliaquest Bowl', record: 398 },
  { name: 'Citrus Bowl', record: 399 }, { name: 'Texas Bowl', record: 400 },
];

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { tableId: t, row: r };
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const seasonTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let seasonTable = seasonTables[0];
  for (const t of seasonTables) {
    if (t.header.recordCapacity > seasonTable.header.recordCapacity) seasonTable = t;
  }
  await seasonTable.readRecords();

  const results = [];
  for (const bowl of REGULAR_BOWLS) {
    const rec = seasonTable.records[bowl.record];
    if (!rec) continue;
    const ref = decodeRef32(rec['BowlGame']);
    if (!ref) { results.push({ ...bowl, error: 'no BowlGame ref' }); continue; }
    const defTable = franchise.getTableById(ref.tableId);
    await defTable.readRecords();
    const defRec = defTable.records[ref.row];
    results.push({
      name: bowl.name,
      record: bowl.record,
      defRow: ref.row,
      daysOffset: defRec.DaysOffset,
      gameTime: defRec.GameTime,
      relativeAppt: defRec.RelativeAppt,
    });
  }

  results.sort((a, b) => (a.daysOffset ?? 999) - (b.daysOffset ?? 999));
  console.log('All 32 regular bowls, sorted by DaysOffset:');
  results.forEach(r => {
    if (r.error) { console.log(`  ${r.name}: ${r.error}`); return; }
    console.log(`  ${r.name} (record ${r.record}): DaysOffset=${r.daysOffset}, GameTime=${r.gameTime}, RelativeAppt=${r.relativeAppt}`);
  });
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
