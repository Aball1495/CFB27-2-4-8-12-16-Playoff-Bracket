#!/usr/bin/env node
/**
 * Writes a raw value onto one field of a specific team's Team record.
 * Pair with read-team-field.mjs: read the correct value from a save
 * where it's still right, then write that exact value here onto a save
 * where it broke.
 *
 * Usage:
 *   node write-team-field.mjs "<path to save>" "<output path>" "<team name>" "<field name>" "<raw value>"
 *
 * The <raw value> must be exactly what read-team-field.mjs printed
 * (without the surrounding quotes if it printed a quoted string - pass
 * the ref string itself).
 *
 * Example:
 *   node write-team-field.mjs "C:\saves\broken.sav" "C:\saves\fixed.sav" "Jax State" "UserCharacter" "00100000110101000000000111011100"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, outputPath, teamName, fieldName, rawValue] = process.argv.slice(2);
if (!savePath || !outputPath || !teamName || !fieldName || rawValue === undefined) {
  console.error('Usage: node write-team-field.mjs "<path to save>" "<output path>" "<team name>" "<field name>" "<raw value>"');
  process.exit(1);
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { teamRow } = await import('./teamLookup.mjs');
  const targetRow = teamRow(teamName);

  const teamTables = franchise.tables.filter(t => t.name === 'Team');
  let teamTable = teamTables[0];
  for (const t of teamTables) {
    if (t.header.recordCapacity > teamTable.header.recordCapacity) teamTable = t;
  }
  await teamTable.readRecords();

  const rec = teamTable.records[targetRow];
  if (!rec) {
    console.error(`Could not find ${teamName} at row ${targetRow}.`);
    process.exit(1);
  }

  let before;
  try {
    before = rec[fieldName];
  } catch (err) {
    before = `<could not read: ${err.message}>`;
  }
  console.log(`Before: ${teamName}.${fieldName} = ${JSON.stringify(before)}`);

  try {
    rec[fieldName] = rawValue;
  } catch (err) {
    console.error(`Could not write field "${fieldName}": ${err.message}`);
    process.exit(1);
  }

  console.log(`After:  ${teamName}.${fieldName} = ${JSON.stringify(rawValue)}`);

  await franchise.save(outputPath);
  console.log(`\nSaved to: ${outputPath}`);
  console.log('Only this one field was touched.');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
