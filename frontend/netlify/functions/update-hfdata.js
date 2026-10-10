/* Netlify Scheduled Function — Daily HF Data Library refresh
 *
 * Runs daily (configurable via netlify.toml [functions] schedule) to download
 * the latest IEX 1-min bars from HF Data Library and commit updated JSON files
 * to the repo. Requires a GitHub PAT with repo:write scope.
 *
 * Deploy: `npm run build && netlify deploy --prod`
 * Trigger: Automatic via Netlify schedule, or manual via Netlify dashboard.
 *
 * Env vars required (set in Netlify dashboard → Site settings → Environment variables):
 *   HF_DATA_KEY       - HF Data Library API key (free, 30-day expiry)
 *   GH_TOKEN          - GitHub Personal Access Token (repo:write scope)
 *   GH_REPO           - Repository in owner/repo format (e.g., "sdmtchebe/tickspy")
 *   HF_TICKERS        - Optional JSON array of tickers (defaults to SPY,QQQ,...)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { ParquetReader } = require('parquetjs');

const HF_API_BASE = 'https://api.hfdatalibrary.com/v1';
const DEFAULT_TICKERS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'AMD'];
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.toString().slice(0, 500)}`));
        } else {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Request timeout')));
  });
}

async function downloadParquet(symbol, apiKey) {
  const url = `${HF_API_BASE}/bars/${encodeURIComponent(symbol)}`;
  console.log(`Downloading ${symbol}...`);
  const { body } = await httpGet(url, { 'X-API-Key': apiKey, Accept: 'application/octet-stream' });
  return body;
}

async function parseParquetToBars(parquetBuffer, symbol) {
  const reader = await ParquetReader.openBuffer(parquetBuffer);
  const cursor = reader.getCursor();
  const bars = [];
  let record;
  while ((record = await cursor.next())) {
    if (record.t && record.o != null && record.h != null && record.l != null && record.c != null) {
      bars.push({
        t: new Date(record.t).toISOString(),
        o: Number(record.o),
        h: Number(record.h),
        l: Number(record.l),
        c: Number(record.c),
        v: Number(record.v || 0)
      });
    }
  }
  await reader.close();
  bars.sort((a, b) => a.t.localeCompare(b.t));
  console.log(`Parsed ${bars.length} bars for ${symbol}`);
  return bars;
}

function buildDailyBars(intradayBars) {
  const byDate = new Map();
  for (const b of intradayBars) {
    const date = b.t.slice(0, 10);
    if (!byDate.has(date) || new Date(b.t) > new Date(byDate.get(date).t)) {
      byDate.set(date, b);
    }
  }
  const daily = [];
  for (const [date, bar] of byDate) {
    daily.push({
      t: new Date(`${date}T13:30:00.000Z`).toISOString(),
      o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v
    });
  }
  daily.sort((a, b) => a.t.localeCompare(b.t));
  return daily.slice(-900);
}

function findSessions(intradayBars) {
  const byDate = new Map();
  for (const b of intradayBars) {
    const dt = new Date(b.t);
    const etMinutes = dt.getUTCHours() * 60 + dt.getUTCMinutes();
    const etDate = dt.toISOString().slice(0, 10);
    if (etMinutes >= RTH_OPEN && etMinutes < RTH_CLOSE) {
      if (!byDate.has(etDate)) byDate.set(etDate, []);
      byDate.get(etDate).push(b);
    }
  }
  const dates = [...byDate.keys()].sort();
  const completeDates = dates.filter(d => byDate.get(d).length >= 20);
  const lastThree = completeDates.slice(-3);
  const sessionBars = lastThree.flatMap(d => byDate.get(d)).sort((a, b) => a.t.localeCompare(b.t));
  return {
    sessionDate: lastThree[lastThree.length - 1] || null,
    sessions: lastThree.length,
    bars: sessionBars
  };
}

function buildPayload(symbol, intradayBars) {
  const daily = buildDailyBars(intradayBars);
  const { sessionDate, sessions, bars } = findSessions(intradayBars);
  return {
    symbol,
    tf: '5Min',
    source: 'hfdatalibrary',
    delayed: true,
    tz: 'America/New_York',
    tzCoverage: 1,
    sessionDate,
    sessions,
    asOf: daily.length ? daily[daily.length - 1].t.slice(0, 10) : null,
    bars,
    daily,
    note: `${sessions} session(s) of 5-minute bars from IEX exchange; the most recent completed session is replayed, delayed end-of-day data. IEX represents ~2-3% of consolidated volume.`
  };
}

async function commitFiles(ghToken, ghRepo, files, message) {
  const tmpDir = '/tmp/hfdata-update-' + Date.now();
  fs.mkdirSync(tmpDir, { recursive: true });
  process.chdir(tmpDir);

  try {
    execSync(`git init -q && git config user.name "netlify-bot" && git config user.email "netlify-bot@users.noreply.github.com"`, { stdio: 'ignore' });
    execSync(`git remote add origin https://${ghToken}@github.com/${ghRepo}.git`, { stdio: 'ignore' });
    execSync(`git fetch --depth=1 origin main`, { stdio: 'ignore' });
    execSync(`git checkout -b main origin/main`, { stdio: 'ignore' });

    // Copy existing repo files
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    execSync(`git add desk/hfdata/`, { stdio: 'ignore' });
    const status = execSync(`git status --porcelain`, { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('No changes to commit');
      return { changed: false };
    }

    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    execSync(`git push origin main`, { stdio: 'ignore' });
    console.log('Committed and pushed changes');
    return { changed: true };
  } finally {
    process.chdir('/');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

exports.handler = async function(event, context) {
  console.log('HF Data Library daily refresh started', new Date().toISOString());

  const apiKey = process.env.HF_DATA_KEY;
  const ghToken = process.env.GH_TOKEN;
  const ghRepo = process.env.GH_REPO;
  const tickersEnv = process.env.HF_TICKERS;

  if (!apiKey) return { statusCode: 500, body: 'Missing HF_DATA_KEY' };
  if (!ghToken) return { statusCode: 500, body: 'Missing GH_TOKEN' };
  if (!ghRepo) return { statusCode: 500, body: 'Missing GH_REPO' };

  let tickers = DEFAULT_TICKERS;
  if (tickersEnv) {
    try { tickers = JSON.parse(tickersEnv); } catch (_) { console.warn('Invalid HF_TICKERS, using defaults'); }
  }

  const files = {};
  let success = 0, failed = 0;

  for (const sym of tickers) {
    try {
      const parquet = await downloadParquet(sym, apiKey);
      const bars = await parseParquetToBars(parquet, sym);
      if (bars.length === 0) throw new Error('No bars parsed');
      const payload = buildPayload(sym, bars);
      files[`desk/hfdata/${sym}.json`] = JSON.stringify(payload, null, 2);
      success++;
    } catch (e) {
      console.error(`FAILED ${sym}: ${e.message}`);
      failed++;
    }
  }

  if (success === 0) {
    return { statusCode: 500, body: `All ${tickers.length} tickers failed` };
  }

  const message = `chore: update HF Data Library prices (${success} ok, ${failed} failed) — ${new Date().toISOString().slice(0, 10)}`;
  const result = await commitFiles(ghToken, ghRepo, files, message);

  console.log('HF Data Library daily refresh completed', new Date().toISOString());
  return {
    statusCode: 200,
    body: JSON.stringify({ success, failed, committed: result.changed, date: new Date().toISOString() })
  };
};