import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lookup = JSON.parse(fs.readFileSync(path.join(__dirname, 'team_lookup.json'), 'utf8'));

// Build a normalized (lowercase, no punctuation) reverse index for forgiving lookups
const normalized = {};
for (const [name, row] of Object.entries(lookup)) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  normalized[key] = row;
}

/**
 * Look up a team's row number by name. Accepts the exact display name
 * ("Texas A&M") or a loosely-typed version ("texas am", "TEXAS A&M").
 * Throws a clear error if the team isn't found, listing close matches.
 */
function teamRow(name) {
  if (typeof name === 'number') return name; // already a row number
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key in normalized) return normalized[key];

  // fuzzy fallback: partial match
  const candidates = Object.keys(lookup).filter(n =>
    n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase())
  );
  if (candidates.length === 1) return lookup[candidates[0]];
  if (candidates.length > 1) {
    throw new Error(`"${name}" is ambiguous. Did you mean one of: ${candidates.join(', ')}?`);
  }
  throw new Error(`Team "${name}" not found. Check spelling against team_lookup.json.`);
}

function rowToName(row) {
  const entry = Object.entries(lookup).find(([, r]) => r === row);
  return entry ? entry[0] : `row${row} (unknown)`;
}

export { teamRow, rowToName, lookup };
