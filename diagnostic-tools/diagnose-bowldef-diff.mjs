#!/usr/bin/env node
/**
 * Diffs the bowl-DEFINITION row (Name, IsPlayoffBowl, PlayoffBracketSlot,
 * Trophy, Conference1/2, colors, etc.) that two SeasonGame records' own
 * BowlGame reference field points at - NOT the SeasonGame records
 * themselves (diagnose-fulldiff.mjs already covers that). This is the one
 * area TECHNICAL_NOTES.md flags as unfinished: PlayoffBracketSlot in
 * particular was never populated/tested, and is the leading theory behind
 * a separate, never-solved bowl-rebranding bug.
 *
 * Usage:
 *   node diagnose-bowldef-diff.mjs "<path to save>" <recordA> <recordB>
 *
 * Example:
 *   node diagnose-bowldef-diff.mjs "C:\saves\dynasty.sav" 925 924
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, recA, recB] = process.argv.slice(2);
if (!savePath || recA === undefined || recB === undefined) {
  console.error('Usage: node diagnose-bowldef-diff.mjs "<path to save>" <recordA> <recordB>');
  process.exit(1);
}
const rowA = parseInt(recA, 10);
const rowB = parseInt(recB, 10);

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { t, r };
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { rowToName } = await import('./teamLookup.mjs');

  const sgTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let sgTable = sgTables[0];
  for (const t of sgTables) {
    if (t.header.recordCapacity > sgTable.header.recordCapacity) sgTable = t;
  }
  await sgTable.readRecords();

  const recA_ = sgTable.records[rowA];
  const recB_ = sgTable.records[rowB];
  if (!recA_) { console.error(`No SeasonGame record at ${rowA}.`); process.exit(1); }
  if (!recB_) { console.error(`No SeasonGame record at ${rowB}.`); process.exit(1); }

  const bowlRefA = decodeRef32(recA_['BowlGame']);
  const bowlRefB = decodeRef32(recB_['BowlGame']);
  if (!bowlRefA) { console.error(`Record ${rowA} has no BowlGame reference set.`); process.exit(1); }
  if (!bowlRefB) { console.error(`Record ${rowB} has no BowlGame reference set.`); process.exit(1); }

  console.log(`Record ${rowA}'s BowlGame -> table ${bowlRefA.t}, row ${bowlRefA.r}`);
  console.log(`Record ${rowB}'s BowlGame -> table ${bowlRefB.t}, row ${bowlRefB.r}\n`);

  const bowlTable = franchise.getTableById(bowlRefA.t);
  if (!bowlTable) { console.error(`Could not find table ID ${bowlRefA.t}.`); process.exit(1); }
  await bowlTable.readRecords();

  const defA = bowlTable.records[bowlRefA.r];
  const defB = bowlTable.records[bowlRefB.r];
  if (!defA) { console.error(`No bowl-def record at row ${bowlRefA.r}.`); process.exit(1); }
  if (!defB) { console.error(`No bowl-def record at row ${bowlRefB.r}.`); process.exit(1); }

  const fieldNames = bowlTable.offsetTable ? bowlTable.offsetTable.map(f => f.name) : [];
  console.log(`Comparing bowl-definition rows across ${fieldNames.length} fields:\n`);

  const teamTableId = franchise.tables
    .filter(t => t.name === 'Team')
    .reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a))
    .header.tableId;

  const rows = [];
  for (const f of fieldNames) {
    let va, vb;
    try { va = defA[f]; } catch (e) { va = `<err: ${e.message}>`; }
    try { vb = defB[f]; } catch (e) { vb = `<err: ${e.message}>`; }

    const refA = decodeRef32(va);
    const refB = decodeRef32(vb);
    let dispA = va, dispB = vb;
    if (refA) dispA = refA.t === teamTableId ? `Team:${rowToName(refA.r)}` : `ref(t${refA.t},r${refA.r})`;
    if (refB) dispB = refB.t === teamTableId ? `Team:${rowToName(refB.r)}` : `ref(t${refB.t},r${refB.r})`;

    rows.push({ f, dispA, dispB, differs: String(dispA) !== String(dispB) });
  }

  console.log('--- DIFFERING FIELDS ---');
  const diffs = rows.filter(r => r.differs);
  if (!diffs.length) console.log('(none - identical)');
  for (const r of diffs) {
    console.log(`  ${r.f.padEnd(20)} A=${JSON.stringify(r.dispA)}   B=${JSON.stringify(r.dispB)}`);
  }

  console.log('\n--- ALL FIELDS ---');
  for (const r of rows) {
    console.log(`${r.differs ? '*' : ' '} ${r.f.padEnd(20)} A=${JSON.stringify(r.dispA)}   B=${JSON.stringify(r.dispB)}`);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
