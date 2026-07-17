#!/usr/bin/env node
/**
 * Diagnostic: the Scores/Schedule screen shows a rank number next to each
 * team in a bowl matchup that does NOT match the CFP/Media/Coaches poll
 * rank fields we've already confirmed and written to. This script brute-
 * force searches the raw bytes of the 4 native Quarterfinal SeasonGame
 * records (928-931, the "Round 1" slots for an 8-team bracket) for a
 * bit-packed field that reproduces the specific wrong numbers you saw
 * on screen - which would mean there's a rank value cached directly in
 * the SeasonGame record itself, separate from the Team table entirely.
 *
 * Usage:
 *   node diagnose-qf-ranks.mjs "<path to your save file>"
 *
 * Run this from inside the NCAA Mods folder (needs node_modules present).
 * Paste the full output back - if it finds a consistent offset, we've
 * found the field; if not, we'll know it's something else entirely.
 */

import { openSave, readMatchup, readRecordBits } from './playoffEditorCore.mjs';
import { rowToName } from './teamLookup.mjs';

const [savePath] = process.argv.slice(2);
if (!savePath) {
  console.error('Usage: node diagnose-qf-ranks.mjs "<path to save file>"');
  process.exit(1);
}

// Record index -> the wrong numbers you actually saw on the Scores/Schedule
// screen for that matchup (home side, away side). Edit these if you've
// re-tested and the numbers have changed, or if a different bracket size
// puts your games in different native slots.
const EXPECTED = {
  928: { label: 'Peach Bowl (Texas A&M vs Ohio State)', home: 1, away: 9 },
  929: { label: 'Fiesta Bowl (Michigan vs Miami)', home: 11, away: 4 },
  930: { label: 'Cotton Bowl (BYU vs Notre Dame)', home: 5, away: 3 },
  931: { label: 'Rose Bowl (SMU vs Boise State)', home: 6, away: 22 },
};

async function main() {
  const { unpackedFileContents, recordsStart, recordSize } = await openSave(savePath, './schemas');
  const buf = Buffer.from(unpackedFileContents);

  for (const [recordIndexStr, info] of Object.entries(EXPECTED)) {
    const recordIndex = parseInt(recordIndexStr, 10);
    const m = readMatchup(buf, recordsStart, recordSize, recordIndex);
    const recStart = recordsStart + recordIndex * recordSize;
    const recordBuf = buf.subarray(recStart, recStart + recordSize);

    console.log(`\n=== Record ${recordIndex}: ${info.label} ===`);
    console.log(`Home (row ${m.home.row}, ${rowToName(m.home.row)}) - looking for value ${info.home}`);
    console.log(`Away (row ${m.away.row}, ${rowToName(m.away.row)}) - looking for value ${info.away}`);

    const totalBits = recordSize * 8;
    const homeMatches = [];
    const awayMatches = [];

    for (let width = 4; width <= 8; width++) {
      for (let offset = 0; offset <= totalBits - width; offset++) {
        const value = readRecordBits(recordBuf, offset, width);
        if (value === info.home) homeMatches.push({ offset, width });
        if (value === info.away) awayMatches.push({ offset, width });
      }
    }

    console.log(`  Candidate offsets matching HOME value ${info.home}: ${homeMatches.length} found`);
    homeMatches.slice(0, 40).forEach(c => console.log(`    bit ${c.offset}, width ${c.width}`));
    if (homeMatches.length > 40) console.log(`    ...and ${homeMatches.length - 40} more`);

    console.log(`  Candidate offsets matching AWAY value ${info.away}: ${awayMatches.length} found`);
    awayMatches.slice(0, 40).forEach(c => console.log(`    bit ${c.offset}, width ${c.width}`));
    if (awayMatches.length > 40) console.log(`    ...and ${awayMatches.length - 40} more`);

    console.log(`\n  Full record hex (100 bytes): ${recordBuf.toString('hex')}`);
  }

  console.log('\n\nDone. Paste this whole output back - if the same (offset, width) shows up as a HOME candidate in some records and an AWAY candidate in others (at the same offset for either side across all 4 records), that consistent offset is almost certainly the real field.');
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
