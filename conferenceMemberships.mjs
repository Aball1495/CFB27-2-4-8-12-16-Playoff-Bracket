/**
 * Reads REAL, exact conference membership directly from the save file -
 * no statistical inference needed. This works because madden-franchise's
 * schema-aware field API can decode the Conference table's "TeamSlots"
 * field, which is itself a reference to a separate slot-array record (one
 * field per slot, each either empty or a reference to a Team row).
 *
 * This exact pattern - table name "Conference", fields "Name" and
 * "TeamSlots", the 32-character-binary-string reference encoding - was
 * found by inspecting a sibling tool (the CFB27 Schedule Generator) that
 * already solved this using the same underlying madden-franchise library
 * we depend on. Not guessed - confirmed from real, working code.
 *
 * Byte-level brute-force search never found this because "TeamSlots" isn't
 * a flat field on the Team or Conference record at all - it's an indirect
 * reference to a whole separate record, whose own fields need to be
 * decoded the same way. This only works through the schema-driven named-
 * field API (record.TeamSlots), not raw buffer offsets.
 */

/** Decode madden-franchise's 32-character binary-string reference encoding
 * (15 bits table ID + 17 bits row) into { t: tableId, r: row }, or null. */
function decodeRef32(binaryStr) {
  if (!binaryStr || typeof binaryStr !== 'string' || binaryStr.length !== 32) return null;
  const tableId = parseInt(binaryStr.slice(0, 15), 2);
  const row = parseInt(binaryStr.slice(15), 2);
  if (!tableId && !row) return null;
  return { t: tableId, r: row };
}

/** Find a table's ID by name (largest instance, matching the game's own
 * "use the biggest one, smaller ones are unused templates" pattern). */
function getTableIdByName(franchise, name) {
  const matches = franchise.tables.filter(t => t.name === name);
  if (!matches.length) throw new Error(`Table not found by name: ${name}`);
  return matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a)).header.tableId;
}

/** Resolve a TeamSlots-style reference into the list of Team-table rows it
 * points to. The referenced record has one field per slot; each slot is
 * either empty or itself a reference - to the Team table if it's a real
 * member, so we keep only slots whose decoded reference table matches
 * teamTableId. */
async function resolveSlotArray(franchise, refString, teamTableId) {
  const ref = decodeRef32(refString);
  if (!ref) return [];
  const table = franchise.getTableById(ref.t);
  await table.readRecords();
  const record = table.records[ref.r];
  if (!record) return [];
  const rows = [];
  for (const field of table.offsetTable) {
    try {
      const decoded = decodeRef32(record[field.name]);
      if (decoded && decoded.t === teamTableId) rows.push(decoded.r);
    } catch {
      // Not every field decodes as a reference - that's expected, skip it.
    }
  }
  return rows;
}

/**
 * Returns [{ name, members: [teamRow, ...] }, ...] - the exact, real
 * conference membership for this save, straight from the data. Also
 * returns `debug` info (available field names, raw values seen on the
 * first record) so a failure can be diagnosed without needing another
 * round-trip.
 */
async function getConferenceMemberships(franchise) {
  const teamTableId = getTableIdByName(franchise, 'Team');
  const conferenceTableId = getTableIdByName(franchise, 'Conference');
  const confTable = franchise.getTableById(conferenceTableId);
  await confTable.readRecords();

  const debug = {
    recordCount: confTable.records.length,
    fieldNames: confTable.offsetTable ? confTable.offsetTable.map(f => f.name) : null,
    firstRecordSample: null,
  };

  if (confTable.records.length > 0 && debug.fieldNames) {
    const sample = {};
    for (const fieldName of debug.fieldNames) {
      try {
        const v = confTable.records[0][fieldName];
        sample[fieldName] = typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '...' : v;
      } catch (err) {
        sample[fieldName] = `<threw: ${err.message}>`;
      }
    }
    debug.firstRecordSample = sample;
  }

  const result = [];
  for (const record of confTable.records) {
    let name;
    try {
      name = String(record.Name || '').trim();
    } catch {
      continue;
    }
    if (!name) continue;

    const members = await resolveSlotArray(franchise, record.TeamSlots, teamTableId);
    if (!members.length && name !== 'Independent') continue;

    result.push({ name, members });
  }
  return { conferences: result, debug };
}

export { getConferenceMemberships, decodeRef32, getTableIdByName, resolveSlotArray };
