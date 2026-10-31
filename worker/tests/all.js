/* The whole Worker test suite. `npm test`, and the deploy workflow, run this.
 *
 *   cd worker && npm test        (or: node tests/all.js)
 *
 * Each suite below is a standalone program with its own tiny harness, so it can
 * still be run on its own while working on one area:
 *
 *   node tests/run.js         feeds, cache, bars, calendar, the handler, the cron
 *   node tests/alerts.js      rules, the tick, the Telegram link flow and webhook
 *   node tests/research.js    the brief, the range model and its walk-forward scorecard
 *   node tests/research-api.js the research routes, caching and symbol validation
 *
 * They are spawned as child processes rather than imported, for two reasons: a
 * suite that stubs `globalThis.fetch` or a timer cannot leak that stub into the
 * next one, and a suite that throws at load time fails only itself.
 *
 * The point of this file is that a new suite cannot be forgotten. Before it
 * existed, `npm test` ran run.js alone and the alert tests passed or failed
 * invisibly, which is the same as not having them.
 *
 * No dependencies: node:child_process is built in.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SUITES = ["run.js", "alerts.js", "comments.js", "research.js", "research-api.js"];

const results = [];
for (const name of SUITES) {
  const file = fileURLToPath(new URL(`./${name}`, import.meta.url));
  console.log(`\n${"=".repeat(72)}\n${name}\n${"=".repeat(72)}`);
  const run = spawnSync(process.execPath, [file], { stdio: "inherit" });
  // A signal (a hang the runner had to kill, or a crash) is a failure too, and
  // reporting it as one is the whole reason the status is captured rather than
  // taken from the last line of output.
  const ok = run.status === 0;
  results.push({ name, ok, detail: run.signal ? `killed by ${run.signal}` : `exit ${run.status}` });
}

console.log(`\n${"=".repeat(72)}`);
for (const r of results) console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name.padEnd(12)} ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
if (failed.length) process.exit(1);
