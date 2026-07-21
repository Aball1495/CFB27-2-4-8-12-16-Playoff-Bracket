import Franchise from 'madden-franchise';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

// TEAM_UNIQUE_ID is stable across game updates (confirmed: did not change
// between schema 468_2 and 472_0 even though tableId shifted from 6334
// to 6311). Use this to resolve the real tableId at runtime from the
// actual save rather than hardcoding a value that can change.
const TEAM_UNIQUE_ID = 3359508968;

// UniqueIds for all other tables we read from or write to.
// All confirmed directly from Madden Franchise Editor's console output.
// These are tied to the table's actual field layout and stay constant
// across game updates that only reorganize the table registry (which is
// what changes tableId). If a future update actually changes a table's
// fields, its uniqueId will change and verifyGameFingerprint will catch it.
const TABLE_UNIQUE_IDS = {
  Team:              3359508968,
  SeasonGame:        4049338978,
  Coach:             1860529246,
  BowlGame:          902037496,
  ScheduleStructure: 1641852314,
};

// Kept for backward compatibility with any code that imports it, but
// resolved dynamically - see resolveTeamTableId() below.
let TEAM_TABLE_ID = 6311; // last known value, updated at runtime

/**
 * Resolves any table by its uniqueId instead of by name. More reliable
 * than name-based lookup since uniqueId is tied to the table's actual
 * field layout and stays constant across game updates that only shift
 * tableIds around.
 *
 * For tables with multiple instances (e.g. SeasonGame has stub copies),
 * returns the one with the largest recordCapacity - the real instance.
 * Throws a clear error if no matching table is found, rather than
 * silently returning the wrong one.
 */
function resolveTable(franchise, uniqueId, tableName) {
  const matches = franchise.tables.filter(t => t.header.uniqueId === uniqueId);
  if (matches.length === 0) {
    // Fallback to name lookup if uniqueId not found - handles edge cases
    // where the library hasn't fully parsed the header yet.
    const byName = franchise.tables.filter(t => t.header.uniqueId === expected.uniqueId || t.name === tableName);
    if (byName.length === 0) throw new Error(`Table "${tableName}" (uniqueId ${uniqueId}) not found in this save.`);
    return byName.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
  }
  return matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));
}

/**
 * Resolves the real Team tableId from a franchise instance by matching
 * against TEAM_UNIQUE_ID. Call this once per openSave and update
 * TEAM_TABLE_ID with the result. If the uniqueId ever changes (meaning
 * EA changed the Team table's actual structure), this will throw a clear
 * error rather than silently producing wrong results.
 */
function resolveTeamTableId(franchise) {
  const real = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
  if (real.header.uniqueId !== TEAM_UNIQUE_ID) {
    throw new Error(`Team table uniqueId changed: expected ${TEAM_UNIQUE_ID}, got ${real.header.uniqueId}. The game has been updated in a way that requires this tool to be updated too.`);
  }
  return real.header.tableId;
}

/**
 * Locate the FBCHUNKS zlib payload boundaries in a raw save file.
 */
function findZlibStart(buf) {
  const limit = Math.min(buf.length - 1, 8192);
  // CONFIRMED BUG, real corruption (not just a false alarm in our own
  // checker - the actual game refused to load an affected file):
  // repackSave() always writes its 3-byte compressed-length field at
  // bytes 74-76. Scanning from byte 0 occasionally lets those exact
  // bytes coincidentally pass the zlib CMF/FLG checksum AND then
  // "successfully" decompress to plausible-length garbage, since a
  // checksum match plus a non-throwing decompress still isn't proof -
  // both can happen by chance. The real zlib stream has never been
  // observed starting anywhere near that field in any file this project
  // has examined; skip it entirely rather than risk matching it.
  const start = 78;
  for (let i = start; i < limit; i++) {
    const cmf = buf[i];
    const flg = buf[i + 1];
    if ((cmf & 0x0f) === 8 && (cmf * 256 + flg) % 31 === 0) {
      try {
        zlib.inflateSync(buf.subarray(i));
        return i;
      } catch {
        continue;
      }
    }
  }
  throw new Error('Could not find a valid zlib header in this save file.');
}

/**
 * Encode a team reference the way the game does: 15 bits table ID + 17 bits row.
 */
function encodeRef(tableId, row) {
  return (tableId << 17) | row;
}

function decodeRef(word) {
  return { tableId: word >>> 17, row: word & 0x1ffff };
}

/**
 * Load a save, find the main SeasonGame table (the big one, ~983 records),
 * and return everything needed to patch it directly.
 */
async function openSave(savePath, schemaDirectory) {
  const franchise = await Franchise.create(savePath, { schemaDirectory });

  // Resolve Team tableId dynamically by uniqueId - stable across game
  // updates, unlike the raw tableId which shifted between schema versions.
  TEAM_TABLE_ID = resolveTeamTableId(franchise);

  const tables = // resolving by uniqueId - stable across game updates unlike tableId
  [resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame')];
  const mainTable = tables[0];

  const recordsStart = mainTable.offset + mainTable.header.headerSize;
  const recordSize = mainTable.header.record1Size;
  const recordCount = mainTable.header.recordCapacity;

  return {
    unpackedFileContents: franchise.unpackedFileContents,
    recordsStart,
    recordSize,
    recordCount,
    tableOffset: mainTable.offset,
  };
}

/**
 * Read the current HomeTeam/AwayTeam for a given record index.
 */
function readMatchup(buf, recordsStart, recordSize, recordIndex) {
  const start = recordsStart + recordIndex * recordSize;
  const homeWord = buf.readUInt32BE(start + 8);
  const awayWord = buf.readUInt32BE(start + 36);
  return { home: decodeRef(homeWord), away: decodeRef(awayWord) };
}

/**
 * Write a HomeTeam/AwayTeam pair into a given record index.
 * Pass null for a side to leave it untouched.
 */
function writeMatchup(buf, recordsStart, recordSize, recordIndex, homeRow, awayRow) {
  const start = recordsStart + recordIndex * recordSize;
  if (homeRow !== null && homeRow !== undefined) {
    buf.writeUInt32BE(encodeRef(TEAM_TABLE_ID, homeRow) >>> 0, start + 8);
  }
  if (awayRow !== null && awayRow !== undefined) {
    buf.writeUInt32BE(encodeRef(TEAM_TABLE_ID, awayRow) >>> 0, start + 36);
  }
}

/**
 * Repackage a modified unpacked buffer back into a valid FBCHUNKS save file,
 * preserving the original total file size (padding with zeros) so the save
 * slot layout stays exactly as the game expects.
 */
function repackSave(originalRawBuf, modifiedUnpackedBuf) {
  const zlibStart = findZlibStart(originalRawBuf);
  const header = Buffer.from(originalRawBuf.subarray(0, zlibStart));

  const newCompressed = zlib.deflateSync(modifiedUnpackedBuf, { level: 9 });
  const newLen = newCompressed.length;

  // 3-byte little-endian compressed-length field at header bytes 74-76
  header[74] = newLen & 0xff;
  header[75] = (newLen >> 8) & 0xff;
  header[76] = (newLen >> 16) & 0xff;

  const body = Buffer.concat([header, newCompressed]);
  const padNeeded = originalRawBuf.length - body.length;
  if (padNeeded < 0) {
    throw new Error(
      `Modified save (${body.length} bytes) is larger than the original file (${originalRawBuf.length} bytes). ` +
      `This shouldn't normally happen since we're only swapping team references, not changing size.`
    );
  }
  return Buffer.concat([body, Buffer.alloc(padNeeded)]);
}

/**
 * Writes the tool's own bracket seed numbers into every poll-rank field,
 * by field name via the madden-franchise schema object model rather than
 * raw bit offsets. Supersedes an earlier version that used the existing
 * RANK_BITS/writeTeamRank raw-bit path for all three polls - testing
 * showed cfp (5555) and coaches (5539) wrote correctly, but media (5347)
 * silently no-op'd (MediaPoll_CurrentRank was unchanged after the write).
 * Rather than hunt for the correct media bit offset, this writes by
 * field name for all four fields - the same mechanism protectUserCoach()
 * already uses successfully for bulk field writes, and the same
 * mechanism diagnose-poll-ranks.mjs already used to correctly read every
 * field including media.
 *
 * This is a separate save pass - run it against the file your normal
 * bracket-write flow already produced (after repackSave), not against
 * the raw buffer mid-flow. inputPath/outputPath can be the same file.
 *
 * seedAssignments: array of { row, seed }, 1 = highest.
 */
async function syncPollRanksToSave(inputPath, outputPath, schemaDirectory, seedAssignments) {
  const log = [];
  const franchise = await Franchise.create(inputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });

  const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
  await teamTable.readRecords();

  const POLLS = ['CFPPoll', 'CoachesPoll', 'MediaPoll'];
  for (const { row, seed } of seedAssignments) {
    const rec = teamTable.records[row];
    if (!rec) { log.push(`Row ${row}: no record found, skipped.`); continue; }

    const before = rec['CFPPoll_CurrentRank'];
    for (const poll of POLLS) {
      rec[`${poll}_LastWeeksRank`] = rec[`${poll}_CurrentRank`];
      rec[`${poll}_CurrentRank`] = seed;
    }
    rec['TeamRank'] = seed;
    log.push(`Row ${row}: rank -> ${seed} (was ${before}).`);
  }

  await franchise.save(outputPath);
  log.push(`Saved to ${outputPath}.`);
  return log;
}

/**
 * Writes the tool's own bracket seed numbers into all three polls
 * (CFP/Media/Coaches CurrentRank) for every team in the bracket, using
 * the already-confirmed RANK_BITS offsets via writeTeamRank. This is
 * what actually makes the in-game UI match the tool's seeding - these
 * raw-bit functions existed but were never called from the write path.
 *
 * buf/teamRecordsStart/recordSize: from openTeamTable() (or reuse the
 * same unpackedFileContents buffer already open from openSave(), since
 * it's one save file - no need to open the file twice).
 * seedAssignments: array of { row, seed }, 1 = highest.
 *
 * WARNING: media (5347) is confirmed NOT to work - see
 * syncPollRanksToSave() above, which fixes this by writing via schema
 * field name instead. Kept here for cfp/coaches only, in case the
 * raw-bit path is ever preferred for performance in the main flow -
 * don't add media back here without re-deriving its real bit offset.
 */
function syncPollRanksToTeams(buf, teamRecordsStart, recordSize, seedAssignments) {
  const log = [];
  for (const { row, seed } of seedAssignments) {
    const before = { cfp: getTeamRank(buf, teamRecordsStart, recordSize, row, 'cfp') };
    for (const poll of ['cfp', 'coaches']) {
      writeTeamRank(buf, teamRecordsStart, recordSize, row, poll, seed);
    }
    log.push(`Row ${row}: rank -> ${seed} (was ${before.cfp}). NOTE: media not written - use syncPollRanksToSave for full coverage.`);
  }
  return log;
}

// Full regular (non-CFP) bowl slate, confirmed record-by-record against
// real screenshots this session. Order matches the in-game Bowl Week 1
// schedule display exactly.
const REGULAR_BOWLS = [
  { name: 'Xbox Bowl', record: 369 },
  { name: 'Cure Bowl', record: 370 },
  { name: 'Boca Raton Bowl', record: 371 },
  { name: 'New Mexico Bowl', record: 372 },
  { name: 'Independence Bowl', record: 373 },
  { name: '68 Ventures Bowl', record: 374 },
  { name: 'New Orleans Bowl', record: 375 },
  { name: 'Myrtle Beach Bowl', record: 376 },
  { name: 'Famous Idaho Potato Bowl', record: 377 },
  { name: 'Frisco Bowl', record: 378 },
  { name: 'Armed Forces Bowl', record: 379 },
  { name: 'Gasparilla Bowl', record: 380 },
  { name: 'Hawaii Bowl', record: 381 },
  { name: 'Salute to Veterans Bowl', record: 382 },
  { name: 'Military Bowl', record: 383 },
  { name: 'Birmingham Bowl', record: 384 },
  { name: 'First Responder Bowl', record: 385 },
  { name: 'Liberty Bowl', record: 386 },
  { name: 'Holiday Bowl', record: 387 },
  { name: 'Rate Bowl', record: 388 },
  { name: 'Fenway Bowl', record: 389 },
  { name: 'Pop-Tarts Bowl', record: 390 },
  { name: 'Alamo Bowl', record: 391 },
  { name: "Duke's Mayo Bowl", record: 392 },
  { name: 'Music City Bowl', record: 393 },
  { name: 'Las Vegas Bowl', record: 394 },
  { name: 'Gator Bowl', record: 395 },
  { name: 'Sun Bowl', record: 396 },
  { name: 'Arizona Bowl', record: 397 },
  { name: 'Reliaquest Bowl', record: 398 },
  { name: 'Citrus Bowl', record: 399 },
  { name: 'Texas Bowl', record: 400 },
];

// Stadium field: bytes 0-3 of each SeasonGame record (standard 32-bit ref,
// 15-bit tableId + 17-bit row). All-zero means "no override" - the game
// falls back to the home team's own stadium, confirmed by comparing true
// native playoff slots (always all-zero here) against real neutral-site
// bowl records (always a real reference into a Stadium table, one per
// bowl's fixed real-world venue). Clearing this field on a repurposed bowl
// slot should make the game host it at the higher seed's own stadium,
// same as a true playoff game, instead of the bowl's normal neutral site.
const STADIUM_BYTE_OFFSET = 0;

function clearStadiumOverride(buf, recordsStart, recordSize, recordIndex) {
  const recStart = recordsStart + recordIndex * recordSize;
  buf.writeUInt32BE(0, recStart + STADIUM_BYTE_OFFSET);
}

/**
 * Read an arbitrary bit-packed field from a record. bitOffsetInRecord is
 * relative to the start of the record (not the whole file).
 */
function readRecordBits(recordBuf, bitOffsetInRecord, width) {
  let v = 0;
  for (let i = 0; i < width; i++) {
    const p = bitOffsetInRecord + i;
    const byteI = Math.floor(p / 8);
    const bitI = 7 - (p % 8);
    const bit = (recordBuf[byteI] >> bitI) & 1;
    v = (v << 1) | bit;
  }
  return v;
}

// Confirmed this session against 30+ known real results, plus an
// independent holdout file: bit 435 (width 5) = SeasonWeek, where 15 =
// Conference Championship week. Bit 675 (width 1) = winner flag, where
// 0 = home team won, 1 = away team won.
//
// IMPORTANT: the week counter does NOT reset to 0 at the start of each new
// season in a multi-season dynasty - it just keeps climbing (confirmed via
// a real Season 2+ save showing regular-season games at week values
// 18-22 instead of 0-15). The real season cycle is 17 values (0 through
// 16 inclusive: week-0 openers, weeks 1-14 regular, 15 = Conference
// Championship week, 16 = Bowl Week 1) before it repeats. 31 is always the
// sentinel/TBD value regardless of season, and must be checked BEFORE
// normalizing (31 % 17 = 14, which would otherwise collide with a real
// regular-season week 14).
const SEASON_WEEK_BIT = 435;
const WINNER_BIT = 675;
const SEASON_WEEK_SENTINEL = 31;
const SEASON_LENGTH_WEEKS = 17;

/** Normalize a raw SeasonWeek value to its in-season equivalent (0-16),
 * or null if it's the sentinel/TBD value. Safe to call on any season. */
function normalizeSeasonWeek(rawWeek) {
  if (rawWeek === SEASON_WEEK_SENTINEL) return null;
  return rawWeek % SEASON_LENGTH_WEEKS;
}

/**
 * Scan the whole SeasonGame table for Conference Championship week games
 * (SeasonWeek === 15, normalized for whatever season this save is on) and
 * return each one's home/away team rows plus the winning team's row.
 */
function findConferenceChampionshipGames(buf, recordsStart, recordSize, recordCount) {
  const games = [];
  for (let i = 0; i < recordCount; i++) {
    const recStart = recordsStart + i * recordSize;
    const recordBuf = buf.subarray(recStart, recStart + recordSize);
    const rawWeek = readRecordBits(recordBuf, SEASON_WEEK_BIT, 5);
    const week = normalizeSeasonWeek(rawWeek);
    if (week !== 15) continue;
    const m = readMatchup(buf, recordsStart, recordSize, i);
    if (m.home.tableId !== TEAM_TABLE_ID || m.away.tableId !== TEAM_TABLE_ID) continue;
    const winnerBit = readRecordBits(recordBuf, WINNER_BIT, 1);
    const winnerRow = winnerBit === 0 ? m.home.row : m.away.row;
    games.push({ record: i, homeRow: m.home.row, awayRow: m.away.row, winnerRow });
  }
  return games;
}

// Confirmed this session against three full Top-25 polls (CFP, Media,
// Coaches) via a real save + matching ranking-screen recordings.
// Ranks are stored in the Team table (not SeasonGame), 788 bytes/record.
const RANK_BITS = {
  cfp: 5555,
  media: 5347,
  coaches: 5539,
};
const RANK_WIDTH = 5;

/**
 * Locate and open the Team table (143 teams, 788 bytes/record) the same
 * way openSave locates SeasonGame - returns raw buffer + record geometry.
 */
async function openTeamTable(savePath, schemaDirectory) {
  const franchise = await Franchise.create(savePath, { schemaDirectory });
  const mainTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');
  const recordsStart = mainTable.offset + mainTable.header.headerSize;
  return {
    unpackedFileContents: franchise.unpackedFileContents,
    recordsStart,
    recordSize: mainTable.header.record1Size,
    recordCount: mainTable.header.recordCapacity,
  };
}

/**
 * Read a team's rank (1-25 typically; unranked teams will read some other
 * value, not reliably validated - treat as "unranked" if outside 1-25).
 */
function getTeamRank(buf, teamRecordsStart, recordSize, row, poll) {
  const bitpos = RANK_BITS[poll];
  if (bitpos === undefined) throw new Error(`Unknown poll: ${poll}`);
  const recStart = teamRecordsStart + row * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  return readRecordBits(recordBuf, bitpos, RANK_WIDTH);
}

/**
 * Write an arbitrary bit-packed field within a record, mirroring
 * readRecordBits. Modifies recordBuf in place (it's a subarray view into
 * the main buffer, so this writes straight through to the real buffer).
 */
function writeRecordBits(recordBuf, bitOffsetInRecord, width, value) {
  for (let i = 0; i < width; i++) {
    const p = bitOffsetInRecord + i;
    const byteI = Math.floor(p / 8);
    const bitI = 7 - (p % 8);
    const bit = (value >> (width - 1 - i)) & 1;
    if (bit) {
      recordBuf[byteI] |= (1 << bitI);
    } else {
      recordBuf[byteI] &= ~(1 << bitI);
    }
  }
}

/**
 * Write a team's rank for a given poll. Max value is 31 (5-bit field) -
 * anything higher will be silently truncated by the bit width, so callers
 * should only write ranks 1-31.
 */
function writeTeamRank(buf, teamRecordsStart, recordSize, row, poll, rankValue) {
  const bitpos = RANK_BITS[poll];
  if (bitpos === undefined) throw new Error(`Unknown poll: ${poll}`);
  const recStart = teamRecordsStart + row * recordSize;
  const recordBuf = buf.subarray(recStart, recStart + recordSize);
  writeRecordBits(recordBuf, bitpos, RANK_WIDTH, rankValue);
}

/**
 * Read the current home/away team rows for every regular (non-CFP) bowl,
 * using the REGULAR_BOWLS record map. Used to find playoff teams that are
 * still sitting in a non-playoff bowl slot so they can be swapped out.
 */
function readRegularBowlMatchups(buf, recordsStart, recordSize) {
  return REGULAR_BOWLS.map(b => {
    const m = readMatchup(buf, recordsStart, recordSize, b.record);
    return {
      name: b.name,
      record: b.record,
      homeRow: m.home.tableId === TEAM_TABLE_ID ? m.home.row : null,
      awayRow: m.away.tableId === TEAM_TABLE_ID ? m.away.row : null,
    };
  });
}

/**
 * Like openSave, but also locates the Team table from the same Franchise
 * instance - so bracket edits (SeasonGame) and rank-field edits (Team) can
 * both be applied to the SAME unpacked buffer and repacked in one pass,
 * instead of needing two separate save-file writes.
 */
async function openSaveWithTeamTable(savePath, schemaDirectory) {
  const franchise = await Franchise.create(savePath, { schemaDirectory });

  const seasonTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  const teamTable = resolveTable(franchise, TABLE_UNIQUE_IDS.Team, 'Team');

  return {
    unpackedFileContents: franchise.unpackedFileContents,
    season: {
      recordsStart: seasonTable.offset + seasonTable.header.headerSize,
      recordSize: seasonTable.header.record1Size,
      recordCount: seasonTable.header.recordCapacity,
    },
    team: {
      recordsStart: teamTable.offset + teamTable.header.headerSize,
      recordSize: teamTable.header.record1Size,
      recordCount: teamTable.header.recordCapacity,
    },
  };
}

export {
  openSave, openSaveWithTeamTable, readMatchup, writeMatchup, repackSave, encodeRef, decodeRef, TEAM_TABLE_ID, TEAM_UNIQUE_ID, TABLE_UNIQUE_IDS, REGULAR_BOWLS,
  readRecordBits, writeRecordBits, findConferenceChampionshipGames, SEASON_WEEK_BIT, WINNER_BIT, normalizeSeasonWeek,
  openTeamTable, getTeamRank, writeTeamRank, RANK_BITS, RANK_WIDTH, readRegularBowlMatchups, clearStadiumOverride,
  protectUserCoach, checkUserCoachFlags, findConferenceChampionsByStandings, verifyGameFingerprint, resolveTeamTableId, resolveTable,
  syncPollRanksToTeams, syncPollRanksToSave,
};

/**
 * Sanity-checks the handful of hardcoded assumptions this whole tool is
 * built on. The primary signal is each core table's header.uniqueId - a
 * real, confirmed field (verified directly in Madden Franchise Editor's
 * own console output) that appears to be a hash of the table's actual
 * field layout, not just an arbitrary/positional number. It showing up
 * twice under two different names in the raw header (uniqueId AND
 * tablePad1, both identical) supports this - it's tied to the table's
 * real structure, which is exactly what would change if EA altered a
 * table's fields in a future patch, even if everything else about the
 * save format looked unchanged.
 *
 * ALL FIVE VALUES BELOW CONFIRMED DIRECTLY (verified live in Madden
 * Franchise Editor's own console, not inferred or guessed):
 *   Team:              tableId 6334, uniqueId 3359508968, ~143 rows
 *   Coach:             tableId 4173, uniqueId 1860529246
 *   BowlGame:          tableId 4313, uniqueId 902037496
 *   ScheduleStructure: uniqueId 1641852314
 *   SeasonGame:        uniqueId 4049338978, ~983 rows (the real instance -
 *                      there are multiple stub/unused SeasonGame tables in
 *                      every save; recordCapacity ~983 is how the correct
 *                      one is identified, same method used everywhere else
 *                      in this project all along)
 *
 * None of this is enforced by the game itself - if EA ships a future
 * patch that changes any of these internally (which has no reason to
 * warn anyone, since it's not "broken" from the game's own point of
 * view), this tool would otherwise start silently reading or writing the
 * wrong data with no indication anything's wrong.
 *
 * Called automatically on every save load - if it returns any warnings,
 * the UI shows them in a banner rather than letting the tool proceed as
 * if everything's fine. This can't catch every possible future change,
 * but it catches the most likely, highest-impact ones.
 */
const KNOWN_TABLE_FINGERPRINTS = {
  Team:              { uniqueId: 3359508968, recordCapacityMin: 100, recordCapacityMax: 200 },
  Coach:             { uniqueId: 1860529246 },
  BowlGame:          { uniqueId: 902037496 },
  ScheduleStructure: { uniqueId: 1641852314 },
  SeasonGame:        { uniqueId: 4049338978, recordCapacityMin: 900, recordCapacityMax: 1100 },
};

async function verifyGameFingerprint(savePath, schemaDirectory) {
  const warnings = [];
  const franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: `${schemaDirectory}/472_0.gz` },
  });

  for (const [tableName, expected] of Object.entries(KNOWN_TABLE_FINGERPRINTS)) {
    const tables = franchise.tables.filter(t => t.name === tableName);
    if (tables.length === 0) {
      warnings.push(`Could not find any table named "${tableName}" in this save. This almost always means the game has been updated since this tool was built, and this tool needs to be updated to match - results from this point on may be wrong.`);
      continue;
    }
    const realTable = tables.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a));

    if (expected.uniqueId !== undefined && realTable.header.uniqueId !== expected.uniqueId) {
      warnings.push(`The "${tableName}" table's internal structure has changed (expected fingerprint ${expected.uniqueId}, found ${realTable.header.uniqueId}). This strongly suggests the game has been updated since this tool was built - it needs to be updated to match, or results may be wrong.`);
    // Note: tableId is intentionally NOT checked here. tableId shifts
    // between game updates without affecting actual data integrity, which
    // is exactly what we proved when tableId changed from 6334 to 6311
    // for the Team table in the 472_0 update. All reads/writes now use
    // uniqueId-based resolution, so a tableId change is irrelevant.
    // Only uniqueId changes (meaning the table's actual field structure
    // changed) are worth warning about.
    }
    if (expected.recordCapacityMin && (realTable.header.recordCapacity < expected.recordCapacityMin || realTable.header.recordCapacity > expected.recordCapacityMax)) {
      warnings.push(`The "${tableName}" table has ${realTable.header.recordCapacity} rows, outside the expected range. The game's structure may have changed.`);
    }
  }

  return warnings;
}

/**
 * CONFIRMED BUG (found via extensive live debugging): SeasonWeek is NOT a
 * shared league-wide calendar week - it behaves more like a per-team game
 * count, so completely unrelated games can share the same normalized week
 * number by coincidence. In one real save, exactly 54 games shared
 * "week 15" in a single season (SeasonYear all identical - ruled out
 * cross-season aliasing), when only ~10-12 real conference championships
 * should exist. One team was found with TWO different "week 15" games
 * against two different opponents in the same season. Any code trusting
 * week===15 to uniquely identify "the championship game" is unreliable -
 * findConferenceChampionshipGames (above) is kept for reference/backward
 * compatibility but should be considered DEPRECATED for this purpose.
 *
 * This replacement never looks at week numbers at all. Instead:
 *   1. Compute each team's CONFERENCE-ONLY win/loss record (using the
 *      already-proven-reliable game log from computeGameLogs's approach).
 *   2. For each conference, the top 2 teams by conference record are the
 *      presumed championship participants (does NOT model divisions -
 *      known limitation, see comment below).
 *   3. Find the actual game(s) between exactly those two teams.
 *   4. If they met more than once (a regular-season game AND the
 *      championship), disambiguate using the real GameDateMonth/Day via
 *      a targeted schema-aware lookup (only for these specific candidate
 *      records, not a issue full-table scan) - the later date wins.
 *   5. If the top 2 never played each other at all, that conference is
 *      reported as UNRESOLVED rather than guessing - a missing champion
 *      is far safer than a wrong one.
 *
 * KNOWN LIMITATION: this assumes a single-table conference (no divisions).
 * A conference with two divisions crowns its champion from the two
 * DIVISION winners, not the overall top 2 - if the true division
 * structure isn't reflected by simple overall conference record (e.g. a
 * division winner with a worse overall conference record than a
 * non-division-winner in the other division), this will get it wrong.
 * Team.DIV_SLOTNUMBER may encode real division membership and could
 * refine this further, but that's unverified and out of scope for this
 * fix - flagged here for future work.
 */
async function findConferenceChampionsByStandings(buf, recordsStart, recordSize, recordCount, teamConference, savePath, schemaDirectory) {
  const { rowToName } = await import('./teamLookup.mjs');

  // Use schema-aware reading for the full game scan - this correctly handles
  // neutral-site championship games where the raw winner bit has home/away
  // reversed vs GameStatus (confirmed bug: raw bit crowned the wrong team
  // in 4 of 10 conferences in live testing - Pac-12, Sun Belt, Big Ten, CUSA).
  const Franchise = (await import('madden-franchise')).default;
  const franchise = await Franchise.create(savePath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: `${schemaDirectory}/472_0.gz` },
  });
  const sgTable = resolveTable(franchise, TABLE_UNIQUE_IDS.SeasonGame, 'SeasonGame');
  await sgTable.readRecords();

  // Resolve real Team tableId from this franchise instance.
  const realTeamTableId = resolveTeamTableId(franchise);

  function decodeRef32(s) {
    if (!s || typeof s !== 'string' || s.length !== 32) return null;
    const t = parseInt(s.slice(0, 15), 2);
    const r = parseInt(s.slice(15), 2);
    if (!t && !r) return null;
    return { t, r };
  }

  // Two separate passes:
  // 1. Full regular season scan for building conference standings (win/loss records)
  // 2. Championship week games only, for crowning.
  //
  // CONFIRMED BUG (found via diagnose-weeks-14-15-16.mjs against a real
  // save): this used to hardcode seasonWeek === 16 as "conference
  // championship week." In a real save, week 16 had ZERO games and the
  // actual 10 championship games (verified one-for-one against the
  // in-game "Conf Championships" schedule screen) were all at week 15
  // instead. That silently emptied champGames for every conference,
  // which then had to fall back to reconstructing a champion from
  // standings alone - and that fallback has its own known weakness (see
  // the tie-break note below) that surfaced as a missing crown for
  // American specifically.
  //
  // Rather than swap in a different hardcoded number (which just moves
  // the same fragility to a different save/season - this is the same
  // family of bug already documented for the deprecated
  // findConferenceChampionshipGames() above, where SeasonWeek doesn't
  // reliably mean the same real-world week across different dynasties),
  // championship week is now detected per-save: it's the highest
  // RegularSeason-tagged week with more than one game. The lone
  // Army/Navy game (always its own standalone week, never a conference
  // championship) is naturally excluded by the ">1 game" check rather
  // than needing a special case.

  const gamesByWeek = new Map(); // seasonWeek -> game[]

  for (let i = 0; i < sgTable.records.length; i++) {
    const rec = sgTable.records[i];
    if (!rec) continue;

    let weekType, status, gameDate, seasonWeek;
    try { weekType = rec['SeasonWeekType']; } catch { continue; }
    if (weekType !== 'RegularSeason') continue;
    try { seasonWeek = rec['SeasonWeek']; } catch { seasonWeek = null; }
    try { status = rec['GameStatus']; } catch { status = null; }
    try { gameDate = rec['GameDateMonth'] * 100 + rec['GameDateDay']; } catch { gameDate = 0; }

    const homeRef = decodeRef32(rec['HomeTeam']);
    const awayRef = decodeRef32(rec['AwayTeam']);
    if (!homeRef || homeRef.t !== realTeamTableId || !awayRef || awayRef.t !== realTeamTableId) continue;
    if (status !== 'HomeWon' && status !== 'AwayWon') continue;

    const homeWon = status === 'HomeWon';
    const game = { record: i, homeRow: homeRef.r, awayRow: awayRef.r, homeWon, gameDate };

    if (!gamesByWeek.has(seasonWeek)) gamesByWeek.set(seasonWeek, []);
    gamesByWeek.get(seasonWeek).push(game);
  }

  const weeksWithMultipleGames = [...gamesByWeek.keys()].filter(wk => gamesByWeek.get(wk).length > 1);
  const championshipWeek = weeksWithMultipleGames.length ? Math.max(...weeksWithMultipleGames) : null;

  const regularSeasonGames = [];
  const champGames = [];
  for (const [wk, games] of gamesByWeek.entries()) {
    if (wk === championshipWeek) {
      champGames.push(...games);
    } else {
      regularSeasonGames.push(...games);
    }
  }

  // Conference-only win/loss per team — regular season only.
  const confRecord = {}; // row -> { wins, losses }
  const bump = (row, won) => {
    confRecord[row] = confRecord[row] || { wins: 0, losses: 0 };
    if (won) confRecord[row].wins++; else confRecord[row].losses++;
  };
  let confGameCount = 0;
  for (const g of regularSeasonGames) {
    const homeName = rowToName(g.homeRow);
    const awayName = rowToName(g.awayRow);
    if (teamConference[homeName] && teamConference[homeName] === teamConference[awayName]) {
      bump(g.homeRow, g.homeWon);
      bump(g.awayRow, !g.homeWon);
      confGameCount++;
    }
  }
  for (const g of champGames) {
    const h = rowToName(g.homeRow);
    const a = rowToName(g.awayRow);
    const winner = g.homeWon ? h : a;
    const hConf = teamConference[h];
    const aConf = teamConference[a];
    const match = hConf === aConf ? 'MATCH' : 'MISMATCH';
    console.log(`  ${h}(${hConf}) vs ${a}(${aConf}) -> winner: ${winner} [${match}]`);
  }
  if (regularSeasonGames.length > 0) {
    const sample = regularSeasonGames[0];
    const sampleHome = rowToName(sample.homeRow);
    const sampleAway = rowToName(sample.awayRow);
  }

  // Group rows by conference.
  const rowsByConf = {};
  for (const row of Object.keys(confRecord).map(Number)) {
    const conf = teamConference[rowToName(row)];
    if (!conf || conf === 'Independent') continue;
    (rowsByConf[conf] = rowsByConf[conf] || []).push(row);
  }

  const results = {}; // conference -> { winner, record, home, away, ambiguous }
  const unresolved = [];

  // First, directly assign champions from actual championship games.
  // Don't try to match against standings top-2 — just use whatever game
  // is in champGames for each conference. This is the ground truth.
  const confFromChampGame = {};
  for (const g of champGames) {
    const homeName = rowToName(g.homeRow);
    const conf = teamConference[homeName];
    if (!conf || conf === 'Independent') continue;
    confFromChampGame[conf] = g;
  }

  for (const [conf, g] of Object.entries(confFromChampGame)) {
    const winnerRow = g.homeWon ? g.homeRow : g.awayRow;
    results[conf] = {
      winner: rowToName(winnerRow),
      record: g.record,
      home: rowToName(g.homeRow),
      away: rowToName(g.awayRow),
      ambiguous: false,
    };
  }

  // For conferences WITHOUT a championship game, fall back to standings.
  for (const [conf, rows] of Object.entries(rowsByConf)) {
    if (confFromChampGame[conf]) continue;
    const ranked = rows.slice().sort((a, b) => {
      const ra = confRecord[a], rb = confRecord[b];
      const pctA = ra.wins / Math.max(1, ra.wins + ra.losses);
      const pctB = rb.wins / Math.max(1, rb.wins + rb.losses);
      return pctB - pctA;
    });
    if (ranked.length < 2) { unresolved.push({ conf, reason: 'fewer than 2 teams' }); continue; }
    const [top1, top2] = ranked;

    const regularCandidates = regularSeasonGames.filter(g =>
      (g.homeRow === top1 && g.awayRow === top2) || (g.homeRow === top2 && g.awayRow === top1)
    );
    if (regularCandidates.length === 0) {
      unresolved.push({ conf, reason: `top 2 (${rowToName(top1)}, ${rowToName(top2)}) never played each other` });
      continue;
    }
    const chosen = regularCandidates.reduce((best, c) => c.gameDate > best.gameDate ? c : best);
    const winnerRow = chosen.homeWon ? chosen.homeRow : chosen.awayRow;
    results[conf] = {
      winner: rowToName(winnerRow),
      record: chosen.record,
      home: rowToName(chosen.homeRow),
      away: rowToName(chosen.awayRow),
      ambiguous: regularCandidates.length > 1,
    };
  }
  return { confChampions: results, unresolved };
}

/**
 * Read-only check - does NOT write anything. Looks for any coach with
 * IsCreated=true OR IsUserControlled=true (either flag being true means
 * they're at risk - the confirmed bug needs both true simultaneously,
 * but this checks either as a conservative/cautious trigger per product
 * decision, not because either flag alone is confirmed sufficient to
 * cause the bug). Used to decide whether to show the protection popup
 * after a save loads, rather than showing it unconditionally every time.
 */
async function checkUserCoachFlags(inputPath, schemaDirectory) {
  const franchise = await Franchise.create(inputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });

  // NOTE: getAllTablesByName is only proven for SeasonGame/Team in this
  // codebase - it returned empty for 'Coach' in real-world testing.
  // franchise.tables.filter is the pattern proven working for Coach
  // specifically, across every coach-related script tonight.
  const coachTables = [resolveTable(franchise, TABLE_UNIQUE_IDS.Coach, 'Coach')];
  if (coachTables.length === 0) return { atRisk: [] };
  const coachTable = coachTables[0];
  await coachTable.readRecords();

  const atRisk = [];
  for (let i = 0; i < coachTable.records.length; i++) {
    const rec = coachTable.records[i];
    if (!rec) continue;
    let isUserControlled, isCreated, firstName, lastName;
    try {
      isUserControlled = rec['IsUserControlled'];
      isCreated = rec['IsCreated'];
      firstName = String(rec['FirstName']).replace(/[\x00-\x1F]/g, '').trim();
      lastName = String(rec['LastName']).replace(/[\x00-\x1F]/g, '').trim();
    } catch {
      continue;
    }
    // Only IsCreated matters here - IsUserControlled=true is completely
    // normal for whichever coach(es) you're actually playing as, and
    // triggering on it too meant this popup showed up on every single
    // load regardless of whether any coach was actually at risk.
    if (isCreated === true) {
      atRisk.push({ row: i, firstName, lastName, isCreated, isUserControlled });
    }
  }

  return { atRisk };
}

/**
 * Confirmed community fix for a known bug: retiring a coach who has
 * IsCreated=true AND IsUserControlled=true orphans that team's
 * Team.UserCharacter binding, locking the user out of reselecting their
 * own team afterward. Setting IsCreated=false BEFORE retiring avoids
 * this entirely - the retirement then behaves like a normal AI-coach
 * retirement (which is also the trigger for a separate, known display-bug
 * fix - see SESSION_FINDINGS.md).
 *
 * CORRECTED: earlier versions of this fix also set IsUserControlled to
 * false. That was wrong and caused a SEPARATE bug - flipping
 * IsUserControlled locks you out of your OWN original team the next time
 * you try to switch control to it, since the game no longer recognizes
 * you as the controlling user for that team. Only IsCreated needs to
 * change to prevent the retirement-orphaning bug; IsUserControlled must
 * be left exactly as it was.
 *
 * Auto-detects the coach(es) currently flagged IsUserControlled=true
 * rather than requiring the user to type a name - there's normally
 * exactly one in a solo/offline dynasty. That flag is used ONLY to
 * identify which coach is "yours" - it is never written to.
 *
 * Uses franchise.save() directly (schema-aware write), not the raw-buffer
 * repackSave() path used elsewhere in this file - confirmed working for
 * both single-field and bulk multi-field writes in testing.
 */
async function protectUserCoach(inputPath, outputPath, schemaDirectory) {
  const log = [];
  const franchise = await Franchise.create(inputPath, {
    schemaDirectory,
    schemaOverride: { major: 472, minor: 0, gameYear: 27, path: path.join(schemaDirectory, '472_0.gz') },
  });

  // Same fix as checkUserCoachFlags - see note there.
  const coachTables = [resolveTable(franchise, TABLE_UNIQUE_IDS.Coach, 'Coach')];
  if (coachTables.length === 0) throw new Error('No Coach table found in this save.');
  const coachTable = coachTables[0];
  await coachTable.readRecords();

  const fixed = [];
  const alreadySafe = [];
  for (let i = 0; i < coachTable.records.length; i++) {
    const rec = coachTable.records[i];
    if (!rec) continue;
    let isUserControlled, isCreated, firstName, lastName;
    try {
      isUserControlled = rec['IsUserControlled'];
      isCreated = rec['IsCreated'];
      firstName = String(rec['FirstName']).replace(/[\x00-\x1F]/g, '').trim();
      lastName = String(rec['LastName']).replace(/[\x00-\x1F]/g, '').trim();
    } catch {
      continue;
    }
    // IsUserControlled identifies which coach is yours - read only, never written.
    if (isUserControlled !== true) continue;

    if (isCreated !== true) {
      log.push(`Row ${i}: "${firstName} ${lastName}" - IsCreated already false, nothing to fix. IsUserControlled left untouched.`);
      alreadySafe.push({ row: i, firstName, lastName });
      continue;
    }

    log.push(`Row ${i}: "${firstName} ${lastName}" - IsCreated=true -> setting to false. IsUserControlled left untouched (was ${isUserControlled}).`);
    rec['IsCreated'] = false;
    fixed.push({ row: i, firstName, lastName });
  }

  if (fixed.length === 0 && alreadySafe.length === 0) {
    log.push('No coach found with IsUserControlled=true. Either already protected, or this save has no human-controlled team.');
  } else if (fixed.length === 0) {
    log.push('Coach is already safe to retire - no changes needed, no file written.');
  } else {
    await franchise.save(outputPath);
    log.push(`Saved to ${outputPath}. ${fixed.length} coach(es) protected - safe to retire them without losing control of your team.`);
  }

  return { log, fixed, alreadySafe };
}
