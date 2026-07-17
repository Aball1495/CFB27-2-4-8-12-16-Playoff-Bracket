#!/usr/bin/env node
/**
 * Reads one field's raw value off a specific team's Team record. General
 * purpose - built here specifically to capture Team.UserCharacter (the
 * UserEntity reference that marks a team as human-controlled) from a
 * save where it's still correct, so it can be written back onto a save
 * where it broke.
 *
 * Usage:
 *   node read-team-field.mjs "<path to save>" "<team name>" "<field name>"
 *
 * Example:
 *   node read-team-field.mjs "C:\saves\dynasty-before-retire.sav" "Jax State" "UserCharacter"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, teamName, fieldName] = process.argv.slice(2);
if (!savePath || !teamName || !fieldName) {
  console.error('Usage: node read-team-field.mjs "<path to save>" "<team name>" "<field name>"');
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

  let value;
  try {
    value = rec[fieldName];
  } catch (err) {
    console.error(`Could not read field "${fieldName}": ${err.message}`);
    process.exit(1);
  }

  console.log(`${teamName} (row ${targetRow}).${fieldName} =`);
  console.log(JSON.stringify(value));
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
