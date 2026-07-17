#!/usr/bin/env node
/**
 * Diagnostic: list every table in the save whose name contains "Conference",
 * and dump basic structure (record count/size) plus the raw hex of the
 * first couple records for each. We've confirmed conference membership
 * isn't stored on the Team table itself - this checks whether it lives in
 * a separate CollegeConference-style table instead.
 *
 * Usage:
 *   node diagnose-conference-table.mjs "<path to save>"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-conference-table.mjs "<path to save>"');
  process.exit(1);
}

async function main() {
  const franchise = await Franchise.create(savePath, { schemaDirectory: path.join(__dirname, 'schemas') });

  const allTableNames = new Set();
  for (const t of franchise.tables) {
    if (t.name) allTableNames.add(t.name);
  }

  const conferenceRelated = [...allTableNames].filter(n => n.toLowerCase().includes('conference'));
  console.log('Tables with "Conference" in the name:');
  conferenceRelated.forEach(n => console.log('  ' + n));

  if (conferenceRelated.length === 0) {
    console.log('\nNone found by that name filter. Printing ALL table names instead so we can eyeball it:');
    [...allTableNames].sort().forEach(n => console.log('  ' + n));
    return;
  }

  for (const name of conferenceRelated) {
    const tables = franchise.getAllTablesByName(name);
    console.log(`\n=== ${name} (${tables.length} instance(s)) ===`);
    for (const t of tables) {
      console.log(`  recordCapacity=${t.header.recordCapacity}, record1Size=${t.header.record1Size}, headerSize=${t.header.headerSize}, offset=${t.offset}`);
    }
  }

  // Dig into the real "Conference" table specifically (not the various
  // CustomConferences*Event/Reaction/Flow tables, which are just game-logic
  // plumbing, not data).
  const mainName = 'Conference';
  const tables = franchise.getAllTablesByName(mainName);
  if (tables.length === 0) {
    console.log(`\nNo table literally named "${mainName}" found - check the list above for the right name and edit this script's mainName constant.`);
    return;
  }
  let mainTable = tables[0];
  for (const t of tables) {
    if (t.header.recordCapacity > mainTable.header.recordCapacity) mainTable = t;
  }
  const recordsStart = mainTable.offset + mainTable.header.headerSize;
  const recordSize = mainTable.header.record1Size;
  const buf = Buffer.from(franchise.unpackedFileContents);

  console.log(`\n=== Raw hex of every record in "${mainName}" ===`);
  console.log(`recordsStart=${recordsStart}, recordSize=${recordSize}, recordCount=${mainTable.header.recordCapacity}`);
  for (let i = 0; i < mainTable.header.recordCapacity; i++) {
    const off = recordsStart + i * recordSize;
    const bytes = buf.subarray(off, off + recordSize);
    console.log(`Record ${i}: ${bytes.toString('hex')}`);
    // Also show it as ASCII where printable, in case the conference name
    // itself is stored as text somewhere in the record.
    const ascii = [...bytes].map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    console.log(`         ascii: ${ascii}`);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
