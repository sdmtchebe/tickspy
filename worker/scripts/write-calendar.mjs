#!/usr/bin/env node
/* Writes the desk's calendar.json from the same module the edge API serves from.
 *
 *   node worker/scripts/write-calendar.mjs frontend/build/calendar.json frontend/build/desk/calendar.json
 *
 * GitHub Pages has no server, so it bakes this file instead: the desk reads it
 * same-origin, and the edge API answers /api/calendar with the same list from
 * the same producer. One implementation, so the two can never disagree about
 * which weeks exist - the failure mode would be a Calendar tab whose "next week"
 * button opened nothing on one host and a full week on the other.
 *
 * An upstream having a bad day is not a failed build here: whatever the two legs
 * returned is written and the caller's own checks decide whether that is good
 * enough to publish. The caller is told when the file is thin.
 */

import { readFile, writeFile } from "node:fs/promises";

import { produceCalendar } from "../src/calendar.js";

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error("usage: node worker/scripts/write-calendar.mjs <out.json> [more.json ...]");
  process.exit(2);
}

let events = [];
try {
  events = await produceCalendar();
} catch (e) {
  console.log(`::warning::calendar upstreams failed: ${(e && e.message) || e}`);
}

/** The list already sitting in one of the target paths, if it still has events. */
async function existing() {
  for (const path of paths) {
    try {
      const list = JSON.parse(await readFile(path, "utf8"));
      if (Array.isArray(list) && list.length) return { path, list };
    } catch (_) {
      // No file yet, or not readable as JSON: nothing to fall back on.
    }
  }
  return null;
}

const body = JSON.stringify(events);
// An empty result never replaces a good file. A bad quarter of an hour at both
// upstreams must not take the published weeks off the site - the weeks that are
// already there stay there until new ones arrive, which is what "it updates
// itself" has to mean in practice.
if (!events.length) {
  const kept = await existing();
  if (kept) {
    console.log(`::warning::calendar upstreams returned nothing; kept the ${kept.list.length} events already in ${kept.path}`);
    process.exit(0);
  }
}

for (const path of paths) await writeFile(path, body);

const rated = events.filter((e) => e.impact).length;
const days = new Set(events.map((e) => String(e.date).slice(0, 10)));
console.log(
  `calendar.json: ${events.length} events (${rated} rated, ${events.length - rated} not rated) ` +
    `over ${days.size} days, ${body.length} bytes -> ${paths.join(", ")}`
);
if (!events.length) console.log("::warning::calendar.json is empty; the Calendar tab will say so");
