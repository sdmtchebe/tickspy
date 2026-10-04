import { useEffect, useRef } from "react";
import { createFeed, bollingerAt, vwapSeries, snapshot } from "@/lib/market";

const MINT = "#00E5A0";
const BEAR = "#FF4D6A";
const AMBER = "#FFB347";
const STEEL = "#8A93A6";
const MONO = "11px 'JetBrains Mono', monospace";
const AXIS_W = 58;
const BAR = 9;

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

function paint(ctx, W, H, feed, opts, hover) {
  const { bands, vwap, volume } = opts;
  const pad = { top: 18, bottom: 26 };
  const plotW = W - AXIS_W;
  const n = Math.max(10, Math.floor((plotW - 24) / BAR));
  const data = feed.candles.slice(-n);
  const bb = bands ? data.map((_, i) => bollingerAt(feed.candles, feed.candles.length - data.length + i)) : null;
  const vw = vwap ? vwapSeries(feed.candles).slice(-data.length) : null;

  let lo = Infinity;
  let hi = -Infinity;
  data.forEach((c, i) => {
    lo = Math.min(lo, c.low, bb ? bb[i].lower : Infinity, vw ? vw[i].value : Infinity);
    hi = Math.max(hi, c.high, bb ? bb[i].upper : -Infinity, vw ? vw[i].value : -Infinity);
  });
  const span = hi - lo || 1;
  lo -= span * 0.06;
  hi += span * 0.06;
  const priceH = H - pad.top - pad.bottom - (volume ? H * 0.2 : 0);
  const y = (p) => pad.top + ((hi - p) / (hi - lo)) * priceH;
  const x = (i) => 10 + i * BAR + BAR / 2;

  ctx.clearRect(0, 0, W, H);

  // grid + price axis
  ctx.font = MONO;
  ctx.textBaseline = "middle";
  const steps = 5;
  for (let k = 0; k <= steps; k++) {
    const p = lo + ((hi - lo) * k) / steps;
    const yy = y(p);
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.beginPath(); ctx.moveTo(0, yy + 0.5); ctx.lineTo(plotW, yy + 0.5); ctx.stroke();
    ctx.fillStyle = STEEL; ctx.textAlign = "left";
    ctx.fillText(p.toFixed(2), plotW + 10, yy);
  }

  // volume
  if (volume) {
    const maxV = Math.max(...data.map((c) => c.volume));
    data.forEach((c, i) => {
      const h = ((c.volume / maxV) * H * 0.18);
      ctx.fillStyle = c.close >= c.open ? "rgba(0,229,160,0.22)" : "rgba(255,77,106,0.22)";
      ctx.fillRect(x(i) - 3, H - pad.bottom - h, 6, h);
    });
  }

  const line = (pts, color, width = 1, dash = []) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
    ctx.restore();
  };

  if (bb) {
    // band fill
    ctx.save();
    ctx.beginPath();
    bb.forEach((b, i) => (i === 0 ? ctx.moveTo(x(i), y(b.upper)) : ctx.lineTo(x(i), y(b.upper))));
    for (let i = bb.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(bb[i].lower));
    ctx.closePath();
    ctx.fillStyle = "rgba(232,236,244,0.035)";
    ctx.fill();
    ctx.restore();
    line(bb.map((b) => b.upper), "rgba(232,236,244,0.35)");
    line(bb.map((b) => b.lower), "rgba(232,236,244,0.35)");
    line(bb.map((b) => b.mid), "rgba(232,236,244,0.2)", 1, [3, 4]);
  }
  if (vw) line(vw.map((v) => v.value), AMBER, 1.8);

  // candles
  data.forEach((c, i) => {
    const up = c.close >= c.open;
    const col = up ? MINT : BEAR;
    const cx = x(i);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx + 0.5, y(c.high)); ctx.lineTo(cx + 0.5, y(c.low)); ctx.stroke();
    const top = y(Math.max(c.open, c.close));
    const h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    ctx.fillRect(cx - 3, top, 7, h);
  });

  // last price marker
  const last = data[data.length - 1];
  const ly = y(last.close);
  const lc = last.close >= last.open ? MINT : BEAR;
  ctx.save();
  ctx.setLineDash([2, 4]); ctx.strokeStyle = "rgba(232,236,244,0.35)";
  ctx.beginPath(); ctx.moveTo(0, ly + 0.5); ctx.lineTo(plotW, ly + 0.5); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = lc;
  ctx.beginPath(); ctx.roundRect(plotW + 4, ly - 9, AXIS_W - 6, 18, 4); ctx.fill();
  ctx.fillStyle = "#03130D"; ctx.textAlign = "left";
  ctx.fillText(last.close.toFixed(2), plotW + 10, ly);

  // time axis
  ctx.fillStyle = STEEL; ctx.textAlign = "center";
  const every = Math.max(1, Math.round(data.length / 6));
  data.forEach((c, i) => {
    if (i % every === 0 && i < data.length - 2) ctx.fillText(hhmm(c.time), x(i), H - 10);
  });

  // crosshair
  if (hover && hover.x < plotW) {
    const i = Math.min(data.length - 1, Math.max(0, Math.round((hover.x - 10 - BAR / 2) / BAR)));
    const c = data[i];
    const hx = x(i);
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(0,229,160,0.4)";
    ctx.beginPath(); ctx.moveTo(hx + 0.5, pad.top); ctx.lineTo(hx + 0.5, H - pad.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hover.y + 0.5); ctx.lineTo(plotW, hover.y + 0.5); ctx.stroke();
    ctx.restore();
    const txt = `O ${c.open.toFixed(2)}  H ${c.high.toFixed(2)}  L ${c.low.toFixed(2)}  C ${c.close.toFixed(2)}`;
    ctx.fillStyle = "rgba(14,19,36,0.92)";
    const tw = ctx.measureText(txt).width + 20;
    ctx.beginPath(); ctx.roundRect(10, 2, tw, 20, 6); ctx.fill();
    ctx.fillStyle = c.close >= c.open ? MINT : BEAR; ctx.textAlign = "left";
    ctx.fillText(txt, 20, 12);
  }
}

export const CandleChart = ({ symbol = "SPY", bands = false, vwap = false, volume = false, interval = 750, onUpdate, testId }) => {
  const ref = useRef(null);
  const cb = useRef(onUpdate);
  cb.current = onUpdate;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const feed = createFeed(symbol);
    const opts = { bands, vwap, volume };
    let hover = null;
    let W = 0;
    let H = 0;

    const draw = () => paint(ctx, W, H, feed, opts, hover);
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(120, Math.floor(r.width));
      H = Math.max(80, Math.floor(r.height));
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);
    resize();
    cb.current?.(snapshot(feed.candles));

    const onMove = (e) => { const r = canvas.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top }; draw(); };
    const onLeave = () => { hover = null; draw(); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const id = setInterval(() => {
      feed.tick();
      draw();
      cb.current?.(snapshot(feed.candles));
    }, interval);

    return () => {
      clearInterval(id);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [symbol, bands, vwap, volume, interval]);

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid={testId}>
      <canvas ref={ref} className="block" aria-label={`${symbol} demo candlestick chart`} />
    </div>
  );
};
