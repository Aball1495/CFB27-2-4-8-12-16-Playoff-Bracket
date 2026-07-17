#!/usr/bin/env node
/**
 * Dumps EVERY schema-visible field (all 69, per the real schema dump - not
 * just the ~10-15 previously hand-checked) on two SeasonGame records side
 * by side, and flags every field where they differ.
 *
 * Point this at a broken record (Miami's bracket slot, or a bowl slot
 * where the team-who-stayed shows the wrong opponent) and a working
 * record of the same general type (another bracket slot, or another
 * regular bowl), and let the diff surface anything the theory-driven
 * investigation hasn't thought to check yet - HomeRequestId, AwayRequestId,
 * GameSessionId, ForceWin, IsRematch, NumberTimesPlayed, etc.
 *
 * Usage:
 *   node diagnose-fulldiff.mjs "<path to save>" <recordA> <recordB>
 *
 * Example:
 *   node diagnose-fulldiff.mjs "C:\saves\mydynasty.sav" 924 925
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, recA, recB] = process.argv.slice(2);
if (!savePath || recA === undefined || recB === undefined) {
  console.error('Usage: node diagnose-fulldiff.mjs "<path to save>" <recordA> <recordB>');
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

  const teamTableId = franchise.tables
    .filter(t => t.name === 'Team')
    .reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a))
    .header.tableId;

  const sgTables = franchise.tables.filter(t => t.name === 'SeasonGame');
  let sgTable = sgTables[0];
  for (const t of sgTables) {
    if (t.header.recordCapacity > sgTable.header.recordCapacity) sgTable = t;
  }
  console.log(`Using SeasonGame table (capacity ${sgTable.header.recordCapacity}).`);
  await sgTable.readRecords();

  const a = sgTable.records[rowA];
  const b = sgTable.records[rowB];
  if (!a) { console.error(`No record at ${rowA}.`); process.exit(1); }
  if (!b) { console.error(`No record at ${rowB}.`); process.exit(1); }

  const fieldNames = sgTable.offsetTable ? sgTable.offsetTable.map(f => f.name) : [];
  console.log(`\nComparing record ${rowA} vs record ${rowB} across ${fieldNames.length} fields.\n`);

  const rows = [];
  for (const f of fieldNames) {
    let va, vb;
    try { va = a[f]; } catch (e) { va = `<err: ${e.message}>`; }
    try { vb = b[f]; } catch (e) { vb = `<err: ${e.message}>`; }

    const refA = decodeRef32(va);
    const refB = decodeRef32(vb);
    let dispA = va, dispB = vb;
    if (refA) dispA = refA.t === teamTableId ? `Team:${rowToName(refA.r)}` : `ref(t${refA.t},r${refA.r})`;
    if (refB) dispB = refB.t === teamTableId ? `Team:${rowToName(refB.r)}` : `ref(t${refB.t},r${refB.r})`;

    const differs = String(dispA) !== String(dispB);
    rows.push({ f, dispA, dispB, differs });
  }

  console.log('--- DIFFERING FIELDS (check these first) ---');
  const diffs = rows.filter(r => r.differs);
  if (!diffs.length) console.log('(none - every field is identical between the two records)');
  for (const r of diffs) {
    console.log(`  ${r.f.padEnd(22)} A=${JSON.stringify(r.dispA)}   B=${JSON.stringify(r.dispB)}`);
  }

  console.log('\n--- ALL FIELDS (for reference) ---');
  for (const r of rows) {
    const marker = r.differs ? '*' : ' ';
    console.log(`${marker} ${r.f.padEnd(22)} A=${JSON.stringify(r.dispA)}   B=${JSON.stringify(r.dispB)}`);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
