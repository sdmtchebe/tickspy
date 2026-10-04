export const TICKERS = {
  SPY: { name: "SPDR S&P 500 ETF", base: 548.32, vol: 0.32 },
  QQQ: { name: "Invesco QQQ Trust", base: 474.9, vol: 0.38 },
  AAPL: { name: "Apple Inc.", base: 226.14, vol: 0.27 },
  NVDA: { name: "NVIDIA Corp.", base: 128.56, vol: 0.42 },
  TSLA: { name: "Tesla Inc.", base: 241.07, vol: 0.85 },
};

function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function createFeed(symbol = "SPY", count = 70, seed = 7) {
  const { base, vol } = TICKERS[symbol] ?? TICKERS.SPY;
  const rnd = seeded(seed + symbol.length * 31);
  const now = Math.floor(Date.now() / 1000 / 60) * 60;
  const candles = [];
  let price = base * 0.992;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (rnd() - 0.47) * vol * 2.2;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rnd() * vol * 0.9;
    const low = Math.min(open, close) - rnd() * vol * 0.9;
    candles.push({ time: now - (count - i) * 60, open, high, low, close, volume: 400 + rnd() * 1600 });
    price = close;
  }
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    const last = candles[candles.length - 1];
    if (ticks % 9 === 0) {
      const open = last.close;
      const c = { time: last.time + 60, open, high: open, low: open, close: open, volume: 120 };
      candles.push(c);
      if (candles.length > count + 40) candles.shift();
      return { candle: c, isNew: true };
    }
    const move = (Math.random() - 0.485) * vol * 0.7;
    last.close = Math.max(1, last.close + move);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
    last.volume += 40 + Math.random() * 180;
    return { candle: last, isNew: false };
  };
  return { candles, tick };
}

export function bollingerAt(candles, i, period = 20) {
  const start = Math.max(0, i - period + 1);
  const slice = candles.slice(start, i + 1).map((c) => c.close);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
  return { mid: mean, upper: mean + 2 * sd, lower: mean - 2 * sd };
}

export function vwapSeries(candles) {
  let pv = 0;
  let v = 0;
  return candles.map((c) => {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    v += c.volume;
    return { time: c.time, value: pv / v };
  });
}

export function atrSeries(candles, period = 14) {
  const out = [];
  let atr = 0;
  candles.forEach((c, i) => {
    const prev = candles[i - 1]?.close ?? c.open;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    atr = i === 0 ? tr : (atr * (period - 1) + tr) / period;
    out.push(atr);
  });
  return out;
}

export function snapshot(candles) {
  const i = candles.length - 1;
  const last = candles[i];
  const first = candles[0];
  const bb = bollingerAt(candles, i);
  const vwap = vwapSeries(candles)[i].value;
  const atr = atrSeries(candles).at(-1) * 6.4;
  const pctB = (last.close - bb.lower) / Math.max(0.0001, bb.upper - bb.lower);
  const change = ((last.close - first.open) / first.open) * 100;
  const score = Math.round(Math.min(96, Math.max(4, 50 + (last.close > vwap ? 14 : -14) + (pctB - 0.5) * 40 + change * 6)));
  const volume = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
  return { price: last.close, change, vwap, atr, pctB, score, volume, bb };
}

export const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "0.00");
