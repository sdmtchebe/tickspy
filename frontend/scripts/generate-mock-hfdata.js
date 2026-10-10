#!/usr/bin/env node
/* generate-mock-hfdata.js — create mock HF Data Library JSON for initial release
 * when no API key is available. The scheduled function will replace with real data.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DESK_HFDATA_DIR = path.join(PROJECT_ROOT, 'desk', 'hfdata');

const TICKERS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'GOOGL', 'AMZN', 'AMD'];

const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

function randomWalk(start, steps, volatility) {
  const out = [];
  let price = start;
  for (let i = 0; i < steps; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility * price;
    price = Math.max(0.01, price + change);
    out.push(price);
  }
  return out;
}

function generateSessionBars(symbol, basePrice, date) {
  const bars = [];
  const minutesPerBar = 5;
  const sessionMinutes = RTH_CLOSE - RTH_OPEN;
  const numBars = Math.floor(sessionMinutes / minutesPerBar);
  const prices = randomWalk(basePrice, numBars, 0.0008);

  for (let i = 0; i < numBars; i++) {
    const minute = RTH_OPEN + i * minutesPerBar;
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const close = prices[i];
    const open = i === 0 ? basePrice : prices[i - 1];
    const high = Math.max(open, close) * (1 + Math.random() * 0.001);
    const low = Math.min(open, close) * (1 - Math.random() * 0.001);
    const volume = Math.floor(Math.random() * 50000) + 10000;

    const isoDate = `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
    bars.push({
      t: isoDate,
      o: Number(open.toFixed(2)),
      h: Number(high.toFixed(2)),
      l: Number(low.toFixed(2)),
      c: Number(close.toFixed(2)),
      v: volume
    });
  }
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

function generateDailyHistory(symbol, basePrice, days) {
  const daily = [];
  let price = basePrice;
  const endDate = new Date(Date.now() - 86400000); // yesterday
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(endDate.getTime() - i * 86400000);
    const dateStr = date.toISOString().slice(0, 10);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const change = (Math.random() - 0.5) * 0.03 * price;
    price = Math.max(0.01, price + change);
    const open = price * (1 + (Math.random() - 0.5) * 0.01);
    const high = Math.max(open, price) * (1 + Math.random() * 0.01);
    const low = Math.min(open, price) * (1 - Math.random() * 0.01);
    const volume = Math.floor(Math.random() * 10000000) + 1000000;

    daily.push({
      t: new Date(`${dateStr}T13:30:00.000Z`).toISOString(),
      o: Number(open.toFixed(2)),
      h: Number(high.toFixed(2)),
      l: Number(low.toFixed(2)),
      c: Number(price.toFixed(2)),
      v: volume
    });
  }
  return daily;
}

function buildPayload(symbol, intradayBars, dailyHistory) {
  const daily = dailyHistory.length ? dailyHistory : buildDailyBars(intradayBars);
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
    note: `${sessions} session(s) of 5-minute bars from IEX exchange; the most recent completed session is replayed, delayed end-of-day data. IEX represents ~2-3% of consolidated volume. [MOCK DATA - will be replaced by scheduled function]`
  };
}

function main() {
  if (!fs.existsSync(DESK_HFDATA_DIR)) {
    fs.mkdirSync(DESK_HFDATA_DIR, { recursive: true });
  }

  const basePrices = {
    SPY: 450, QQQ: 380, AAPL: 180, NVDA: 120, TSLA: 250,
    MSFT: 420, META: 500, GOOGL: 140, AMZN: 180, AMD: 160
  };

  // Use yesterday's date for the "previous completed session"
  const yesterday = new Date(Date.now() - 86400000);
  const dateStr = yesterday.toISOString().slice(0, 10);

  console.log(`Generating mock HF data for ${TICKERS.length} tickers (session date: ${dateStr})...`);

  for (const sym of TICKERS) {
    const basePrice = basePrices[sym] || 100;
    // Generate 3 sessions of intraday data
    const allBars = [];
    for (let d = 2; d >= 0; d--) {
      const day = new Date(yesterday.getTime() - d * 86400000);
      const dayStr = day.toISOString().slice(0, 10);
      allBars.push(...generateSessionBars(sym, basePrice, dayStr));
    }
    // Generate ~200 daily bars for volatility model
    const dailyHistory = generateDailyHistory(sym, basePrice, 300);

    const payload = buildPayload(sym, allBars, dailyHistory);
    const outPath = path.join(DESK_HFDATA_DIR, `${sym}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`  Wrote ${outPath} (${payload.bars.length} intraday bars, ${payload.daily.length} daily bars)`);
  }

  console.log('\nMock HF data generated. The Netlify scheduled function will replace with real data when HF_DATA_KEY is configured.');
}

main();