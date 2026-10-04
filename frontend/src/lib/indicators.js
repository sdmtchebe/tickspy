// The 14 indicators the TickSPY desk computes for every ticker, with demo baselines
// (values drawn from a real SPY session) and plain English explanations.
const f2 = (v) => v.toFixed(2);

export const INDICATORS = [
  {
    id: "ema", name: "Trend (EMA 9 vs 21)", base: [81.05, 81.02], jitter: 0.04,
    fmt: ([a, b]) => `EMA9 ${f2(a)} / EMA21 ${f2(b)}`,
    tone: ([a, b]) => (a > b + 0.02 ? "bull" : a < b - 0.02 ? "bear" : "warn"),
    tip: "Two moving averages. When the fast one (9) sits above the slow one (21) the short-term trend is up.",
  },
  {
    id: "vwap", name: "VWAP", base: [81.29], jitter: 0.03,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v < 81.2 ? "bull" : v > 81.4 ? "bear" : "warn"),
    tip: "Volume weighted average price. The average price paid today. Price above it means buyers are in control.",
  },
  {
    id: "rsi", name: "RSI (14)", base: [57.05], jitter: 1.6,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v > 70 ? "bear" : v < 30 ? "bull" : v >= 50 ? "bull" : "warn"),
    tip: "Relative strength, 0 to 100. Above 70 is overbought, below 30 is oversold, 50 is the midline.",
  },
  {
    id: "macd", name: "MACD histogram", base: [0.01], jitter: 0.012,
    fmt: ([v]) => (v >= 0 ? "+" : "") + f2(v),
    tone: ([v]) => (v > 0.005 ? "bull" : v < -0.005 ? "bear" : "warn"),
    tip: "Gap between the MACD line and its signal. Positive and growing means momentum is building up.",
  },
  {
    id: "pctb", name: "Bollinger %B", base: [0.7], jitter: 0.05,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v > 0.9 || v < 0.1 ? "warn" : v >= 0.5 ? "bull" : "bear"),
    tip: "Where price sits inside its Bollinger bands. 0 is the lower band, 1 is the upper band.",
  },
  {
    id: "rvol", name: "Relative volume", base: [0.15], jitter: 0.04, unit: "x",
    fmt: ([v]) => `${f2(v)}x`,
    tone: ([v]) => (v > 1.3 ? "bull" : v < 0.5 ? "warn" : "bull"),
    tip: "Today's volume versus the normal volume for this time of day. Under 0.5x means a quiet tape.",
  },
  {
    id: "obv", name: "On-balance volume (10 bars)", base: [1], jitter: 0.6,
    fmt: ([v]) => (v > 0.2 ? "Rising" : v < -0.2 ? "Falling" : "Flat"),
    tone: ([v]) => (v > 0.2 ? "bull" : v < -0.2 ? "bear" : "warn"),
    tip: "Adds volume on up bars and subtracts it on down bars. Rising OBV means volume is backing the move.",
  },
  {
    id: "atr", name: "ATR (14)", base: [0.08], jitter: 0.008,
    fmt: ([v]) => `${f2(v)} (${(v / 0.81).toFixed(2)}%)`,
    tone: ([v]) => (v > 0.14 ? "warn" : "bull"),
    tip: "Average true range. How far price typically moves per bar. Use it to size stops.",
  },
  {
    id: "adx", name: "ADX (14)", base: [11.36, 29.83, 25.33], jitter: 1.1,
    fmt: ([a, p, m]) => `${f2(a)} (DI+ ${f2(p)} / DI- ${f2(m)})`,
    tone: ([a, p, m]) => (a < 20 ? "warn" : p > m ? "bull" : "bear"),
    tip: "Trend strength. Under 20 means no real trend. DI+ above DI- means buyers lead.",
  },
  {
    id: "stoch", name: "Stochastic (14,3)", base: [93.22, 95.48], jitter: 1.4,
    fmt: ([k, d]) => `${f2(k)} / ${f2(d)}`,
    tone: ([k]) => (k > 80 ? "warn" : k < 20 ? "bull" : "bull"),
    tip: "Where the close sits in the recent high-low range. Above 80 is overbought, below 20 is oversold.",
  },
  {
    id: "cci", name: "CCI (20)", base: [64.2], jitter: 9,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v > 100 ? "warn" : v > 0 ? "bull" : v < -100 ? "warn" : "bear"),
    tip: "Commodity channel index. How far price is from its average. Beyond +/-100 is stretched.",
  },
  {
    id: "willr", name: "Williams %R (14)", base: [-6.78], jitter: 3,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v > -20 ? "warn" : v < -80 ? "bull" : "bull"),
    tip: "Like stochastic but flipped, from 0 to -100. Above -20 is overbought, below -80 is oversold.",
  },
  {
    id: "mfi", name: "MFI (14)", base: [41.89], jitter: 1.8,
    fmt: ([v]) => f2(v),
    tone: ([v]) => (v > 80 ? "bear" : v < 20 ? "bull" : v >= 50 ? "bull" : "warn"),
    tip: "Money flow index. RSI with volume mixed in. Shows whether money is moving in or out.",
  },
  {
    id: "keltner", name: "Keltner / squeeze", base: [0.4], jitter: 0.15,
    fmt: ([v]) => (v < 0.3 ? "Squeeze on" : v < 0.6 ? "Firing" : "Open"),
    tone: ([v]) => (v < 0.3 ? "warn" : "bull"),
    tip: "Bollinger bands inside Keltner channels means a squeeze. Energy is building and a breakout often follows.",
  },
];

export const jitterValues = (ind, vals) => vals.map((v) => v + (Math.random() - 0.5) * ind.jitter);

export const PRICE_ALERT_TICKERS = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];
