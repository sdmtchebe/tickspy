#!/usr/bin/env node
/* download-hfdata.js — fetch 1-min IEX bars from HF Data Library and
 * write desk-ready JSON to ../desk/hfdata/<SYMBOL>.json
 *
 * Run at build time (npm run build) or manually via npm run update-hfdata.
 * Requires HF Data Library API key (free, 30-day expiry).
 * Set HF_DATA_KEY env var or create .hfdata-key file in project root.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { ParquetReader } = require('parquetjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DESK_HFDATA_DIR = path.join(PROJECT_ROOT, 'desk', 'hfdata');
const KEY_FILE = path.join(PROJECT_ROOT, '.hfdata-key');

const DEFAULT_TICKERS = [
  'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA',
  'MSFT', 'META', 'GOOGL', 'AMZN', 'AMD'
];

const HF_API_BASE = 'https://api.hfdatalibrary.com/v1';

function readApiKey() {
  if (process.env.HF_DATA_KEY) return process.env.HF_DATA_KEY.trim();
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
  return null;
}

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
  console.log(`  Downloading ${symbol}...`);
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
  console.log(`  Parsed ${bars.length} bars for ${symbol}`);
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
  const RTH_OPEN = 9 * 60 + 30;
  const RTH_CLOSE = 16 * 60;
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

function writeSymbolFile(symbol, intradayBars) {
  const daily = buildDailyBars(intradayBars);
  const { sessionDate, sessions, bars } = findSessions(intradayBars);
  const payload = {
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
  const outPath = path.join(DESK_HFDATA_DIR, `${symbol}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`  Wrote ${outPath} (${bars.length} intraday bars, ${daily.length} daily bars)`);
}

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error('ERROR: No HF Data Library API key found.');
    console.error('Set HF_DATA_KEY env var or create .hfdata-key file in project root.');
    console.error('Get a free key at https://hfdatalibrary.com (expires 30 days).');
    process.exit(1);
  }

  if (!fs.existsSync(DESK_HFDATA_DIR)) {
    fs.mkdirSync(DESK_HFDATA_DIR, { recursive: true });
  }

  const tickersFile = path.join(PROJECT_ROOT, 'hfdata-tickers.json');
  let tickers = DEFAULT_TICKERS;
  if (fs.existsSync(tickersFile)) {
    try {
      tickers = JSON.parse(fs.readFileSync(tickersFile, 'utf8'));
      console.log(`Using custom ticker list from hfdata-tickers.json: ${tickers.join(', ')}`);
    } catch (e) {
      console.warn('Failed to parse hfdata-tickers.json, using defaults');
    }
  } else {
    console.log(`Using default tickers: ${tickers.join(', ')}`);
    console.log('Create hfdata-tickers.json in project root to customize.');
  }

  let success = 0, failed = 0;
  for (const sym of tickers) {
    try {
      const parquet = await downloadParquet(sym, apiKey);
      const bars = await parseParquetToBars(parquet, sym);
      if (bars.length === 0) throw new Error('No bars parsed');
      writeSymbolFile(sym, bars);
      success++;
    } catch (e) {
      console.error(`  FAILED ${sym}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
  if (failed === tickers.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });