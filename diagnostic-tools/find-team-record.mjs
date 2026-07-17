#!/usr/bin/env node
/**
 * Finds every SeasonGame record a given team appears in (as either
 * HomeTeam or AwayTeam), and prints the record number, the opponent,
 * GameStatus, and SeasonWeek for each. Use this to find the record
 * numbers needed for diagnose-fulldiff.mjs, instead of guessing which
 * of the fixed bracket/bowl indices a team landed in.
 *
 * Usage:
 *   node find-team-record.mjs "<path to save>" "<team name>"
 *
 * Example:
 *   node find-team-record.mjs "C:\saves\mydynasty.sav" "Miami"
 *   node find-team-record.mjs "C:\saves\mydynasty.sav" "North Dakota State"
 */
import Franchise from 'madden-franchise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [savePath, teamName] = process.argv.slice(2);
if (!savePath || !teamName) {
  console.error('Usage: node find-team-record.mjs "<path to save>" "<team name>"');
  process.exit(1);
}

function decodeRef32(s) {
  if (!s || typeof s !== 'string' || s.length !== 32) return null;
  const t = parseInt(s.slice(0, 15), 2);
  const r = parseInt(s.slice(15), 2);
  if (!t && !r) return null;
  return { t, r };
}

// SeasonWeek doesn't reset between seasons - normalize the same way
// playoffEditorCore.mjs does, so weeks are readable across a multi-season dynasty.
function normalizeSeasonWeek(raw) {
  if (raw === 31) return 31; // sentinel, leave as-is
  return raw % 17;
}

async function main() {
  const franchise = await Franchise.create(savePath, {
    schemaDirectory: path.join(__dirname, 'schemas'),
    autoParse: true,
    schemaOverride: { major: 468, minor: 2, gameYear: 27, path: path.join(__dirname, 'schemas', '468_2.gz') },
  });

  const { teamRow, rowToName } = await import('./teamLookup.mjs');
  const targetRow = teamRow(teamName);
  console.log(`Searching for "${teamName}" (Team row ${targetRow}) across all SeasonGame records...\n`);

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

  const matches = [];
  for (let i = 0; i < sgTable.records.length; i++) {
    const rec = sgTable.records[i];
    if (!rec) continue;

    let homeRef, awayRef;
    try { homeRef = decodeRef32(rec['HomeTeam']); } catch { homeRef = null; }
    try { awayRef = decodeRef32(rec['AwayTeam']); } catch { awayRef = null; }

    const isHome = homeRef && homeRef.t === teamTableId && homeRef.r === targetRow;
    const isAway = awayRef && awayRef.t === teamTableId && awayRef.r === targetRow;
    if (!isHome && !isAway) continue;

    const oppRef = isHome ? awayRef : homeRef;
    const oppName = oppRef && oppRef.t === teamTableId ? rowToName(oppRef.r) : '(no opponent set)';

    let status, week, simmed;
    try { status = rec['GameStatus']; } catch { status = '?'; }
    try { week = normalizeSeasonWeek(rec['SeasonWeek']); } catch { week = '?'; }
    try { simmed = rec['IsSimmed']; } catch { simmed = '?'; }

    matches.push({ record: i, side: isHome ? 'Home' : 'Away', opponent: oppName, status, week, simmed });
  }

  if (!matches.length) {
    console.log(`No SeasonGame records found referencing "${teamName}". Double-check the name matches team_lookup.json's spelling.`);
    return;
  }

  console.log(`Found ${matches.length} record(s):\n`);
  for (const m of matches) {
    console.log(`  Record ${m.record}: ${teamName} (${m.side}) vs ${m.opponent} | Week ${m.week} | GameStatus=${m.status} | IsSimmed=${m.simmed}`);
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
