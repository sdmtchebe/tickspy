/* research.js — the Research tab.
 *
 * The desk's data path stays in index.html. This file only renders what the
 * Worker's /api/research endpoints return, so the tab can be opened without
 * touching the chart, the replay clock, or the Alpaca keys.
 *
 * The brief is deliberately not generated text. Every sentence arrives with
 * the evidence the Worker used to build it, and this view shows that evidence
 * beside the words. If a value is missing, the server says so; this file never
 * fills a gap with a guess or a zero.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  const state = {
    edge: "",
    symbol: null,
    data: null,
    market: null,
    loading: false,
    marketLoading: false,
    error: "",
    marketError: "",
    queued: false,
  };

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text || "";
  }

  function setHTML(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }

  function showError(message) {
    const box = $("rerror");
    if (!box) return;
    if (!message) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `<div class="panel" style="margin-top:12px"><div class="pbody"><p class="x" style="margin:0">${esc(message)}</p></div></div>`;
  }

  function cacheAge(cache) {
    if (!cache) return "";
    if (cache.stale) return " · stale copy";
    if (Number.isFinite(cache.ageSeconds) && cache.ageSeconds >= 60) {
      return ` · cached ${Math.round(cache.ageSeconds / 60)}m`;
    }
    return " · fresh";
  }

  function dateLabel(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
    const d = new Date(`${s}T12:00:00Z`);
    if (!Number.isFinite(d.getTime())) return s;
    return d.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function blockHTML(block, compact) {
    const evidence = Array.isArray(block.evidence) ? block.evidence : [];
    return `<div class="rblock${compact ? " rcompact" : ""}">
      <div class="rh"><h3>${esc(block.title)}</h3></div>
      <p>${esc(block.text)}</p>
      ${evidence.length ? `<div class="revrow">${evidence.map((e) => `<span class="rev" title="${esc(e.label)}">${esc(e.label)} <b>${esc(e.value)}</b></span>`).join("")}</div>` : ""}
    </div>`;
  }

  function stat(label, value, note) {
    return `<div class="rstat"><span>${esc(label)}</span><b class="num">${esc(value)}</b><i>${esc(note)}</i></div>`;
  }

  function modelHTML(model) {
    if (!model) {
      return `<p class="x">The range model needs at least 80 daily bars. This symbol does not have enough history yet, so no band is shown and no coverage is claimed.</p>`;
    }
    const b = model.band;
    const p10 = b.p10 * 100;
    const p50 = b.p50 * 100;
    const p90 = b.p90 * 100;
    const scale = Math.max(p90 * 1.25, 0.01);
    const left = Math.max(0, Math.min(98, (p10 / scale) * 100));
    const width = Math.max(1.5, Math.min(100 - left, ((p90 - p10) / scale) * 100));
    const median = Math.max(1, Math.min(99, (p50 / scale) * 100));
    const last = Number.isFinite(model.lastRangePct) ? model.lastRangePct * 100 : null;
    const lastPos = last == null ? null : Math.max(1, Math.min(99, (last / scale) * 100));
    const cov = model.backtest.coverage;
    const sessions = model.backtest.sessions;
    return `<div class="rbig num">${p10.toFixed(2)}%–${p90.toFixed(2)}%</div>
      <p class="x" style="margin-top:2px">Nominal 80% band for the next session's high-low range; median ${p50.toFixed(2)}% of price.</p>
      <div class="rband">
        <div class="rband-track" role="img" aria-label="Next-session range band from ${p10.toFixed(2)} percent to ${p90.toFixed(2)} percent, median ${p50.toFixed(2)} percent">
          <i style="left:${left}%;width:${width}%"></i>
          <b style="left:${median}%" title="Median ${p50.toFixed(2)}%"></b>
          ${lastPos == null ? "" : `<em style="left:${lastPos}%" title="Last session ${last.toFixed(2)}%"></em>`}
        </div>
        <div class="rband-l"><span>0%</span><span>${scale.toFixed(1)}%</span></div>
      </div>
      <div class="rgrid">
        ${stat("80% band coverage", `${Math.round(cov["80"] * 100)}%`, `${sessions} walk-forward sessions`)}
        ${stat("50% band coverage", `${Math.round(cov["50"] * 100)}%`, "nominal 50%")}
        ${stat("90% band coverage", `${Math.round(cov["90"] * 100)}%`, "nominal 90%")}
        ${stat("Median width", `${(model.backtest.medianWidth * 100).toFixed(2)}%`, "p10–p90")}
        ${stat("Median error", `${(model.backtest.mae * 100).toFixed(2)}%`, "p50 vs actual")}
        ${stat("Neighbours", `${model.k}`, `from ${model.sample} prior sessions`)}
      </div>
      <p class="rnote">The amber marker is the last completed session's actual range; the green line is the median. Walk-forward means each prediction used only bars that had already closed; appending future bars cannot change an earlier band.</p>
      <details class="rmethod"><summary>How this is calculated</summary><p class="iexp">For each close, the model takes the ${model.k} historical sessions with the closest volatility score, where the score is 0.65 × log(20-session realized volatility) + 0.35 × log(ATR14 ÷ price). The target is the next session's high-low range as a fraction of the close. The percentiles of those targets form the band. A session is only allowed to be a neighbour if it closed before the prediction. The coverage figures are the result of repeating that exact procedure over the last ${sessions} sessions, not a claim about the future.</p></details>`;
  }

  function evidenceHTML(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<p class="x">No evidence rows were returned.</p>`;
    }
    return `<div class="rtable">${rows.map((r) => `<div class="rtr"><span>${esc(r.label)}</span><b class="num">${esc(r.value)}</b></div>`).join("")}</div>`;
  }

  function limitsHTML(gaps) {
    const list = Array.isArray(gaps) ? gaps : [];
    return `<ul class="rlist">${list.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
      <div class="disc" style="margin:10px 0 0"><b>Computed, not generated.</b> This is a description of past prices and a historical range estimate, not investment advice, not a direction forecast, and not a recommendation. A band can be wrong; the published coverage says how often this one was right in the test window.</div>`;
  }

  function renderSymbol() {
    const d = state.data;
    if (!d) {
      setText("rwhen", "");
      setHTML("rbrief", `<p class="x">Open the tab to build the brief.</p>`);
      setHTML("rmodel", `<p class="x">The model appears with the brief.</p>`);
      setHTML("revidence", `<p class="x">Evidence appears with the brief.</p>`);
      setHTML("rlimits", `<p class="x">Limits appear with the brief.</p>`);
      return;
    }
    setText("rsym", d.symbol || "");
    if (!d.available) {
      // The header tagline would otherwise keep whatever it said while loading
      // ("daily bars · delayed" or "building…") and contradict the message below.
      setText("rstat", "not enough history");
      setText("rwhen", d.asOf ? `as of ${dateLabel(d.asOf)}` : "");
      setHTML("rbrief", `<p class="x" style="margin:0">${esc(d.message || "This symbol does not have enough daily history for a brief.")}</p>`);
      setHTML("rmodel", `<p class="x">No model for this symbol.</p>`);
      setHTML("revidence", `<p class="x">No evidence rows.</p>`);
      setHTML("rlimits", `<p class="x">The brief needs at least 40 completed daily sessions.</p>`);
      return;
    }
    const b = d.brief;
    setHTML(
      "rbrief",
      `<div class="rheadline">${esc(b.headline)}</div>${(b.blocks || []).map((x) => blockHTML(x, false)).join("")}`
    );
    setHTML("rmodel", modelHTML(d.model));
    setHTML("revidence", evidenceHTML(d.evidence));
    setHTML("rlimits", limitsHTML(b.dataGaps));
    setText(
      "rwhen",
      `as of ${dateLabel(d.asOf)}${d.source ? ` · ${d.source}` : ""}${d.delayed ? " · delayed" : ""}${cacheAge(d.cache)}`
    );
    setText("rstat", d.available ? "daily bars · delayed" : "not enough history");
  }

  function renderMarket() {
    const m = state.market;
    if (!m) {
      setHTML("rmarket", `<p class="x">The market brief loads with the tab.</p>`);
      return;
    }
    if (!m.available) {
      setText("rmstat", "unavailable");
      setHTML("rmarket", `<p class="x" style="margin:0">${esc(m.message || "The market brief is unavailable.")}</p>`);
      return;
    }
    const b = m.brief;
    setHTML(
      "rmarket",
      `<div class="rheadline" style="font-size:15px">${esc(b.headline)}</div>${(b.blocks || []).map((x) => blockHTML(x, true)).join("")}`
    );
    setText("rmstat", `as of ${dateLabel(m.asOf)}${cacheAge(m.cache)}`);
  }

  async function getJSON(path, timeoutMs = 20000) {
    if (!state.edge) throw new Error("The edge API is not configured, so the research brief cannot load.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(state.edge + path, {
        signal: ctl.signal,
        headers: { Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || `${res.status} ${res.statusText || "request failed"}`);
      }
      return body;
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("The research request timed out.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadSymbol(force) {
    const symbol = state.symbol;
    if (!symbol) return;
    if (state.loading) {
      if (force) state.queued = true;
      return;
    }
    if (!force && state.data && state.data.symbol === symbol) return;
    state.loading = true;
    state.error = "";
    showError("");
    setText("rstat", "building...");
    setHTML("rbrief", `<p class="x">Building the brief from the completed daily bars...</p>`);
    setHTML("rmodel", `<p class="x">Loading the range model...</p>`);
    setHTML("revidence", `<p class="x">Loading the evidence...</p>`);
    try {
      const data = await getJSON(`/api/research/brief?symbol=${encodeURIComponent(symbol)}`, 25000);
      if (symbol !== state.symbol) return;
      state.data = data;
      renderSymbol();
    } catch (e) {
      if (symbol !== state.symbol) return;
      state.data = null;
      state.error = String((e && e.message) || e);
      showError(`Research brief unavailable: ${state.error}`);
      setText("rstat", "unavailable");
      setHTML("rbrief", `<p class="x">The brief could not be built. ${esc(state.error)}</p>`);
      setHTML("rmodel", `<p class="x">No model loaded.</p>`);
      setHTML("revidence", `<p class="x">No evidence loaded.</p>`);
    } finally {
      state.loading = false;
      if (state.queued) {
        state.queued = false;
        loadSymbol(true);
      }
    }
  }

  async function loadMarket(force) {
    if (state.marketLoading) return;
    if (!force && state.market) return;
    state.marketLoading = true;
    state.marketError = "";
    setHTML("rmarket", `<p class="x">Building the market brief from the desk's default daily series...</p>`);
    try {
      const data = await getJSON("/api/research/market", 25000);
      state.market = data;
      renderMarket();
    } catch (e) {
      state.market = null;
      state.marketError = String((e && e.message) || e);
      setHTML("rmarket", `<p class="x">Market brief unavailable: ${esc(state.marketError)}</p>`);
      setText("rmstat", "unavailable");
    } finally {
      state.marketLoading = false;
    }
  }

  function visible() {
    const tab = $("t-research");
    return !!(tab && tab.classList.contains("on"));
  }

  function open(options) {
    if (options && options.edgeApi) state.edge = options.edgeApi;
    const symbol = options && options.symbol ? String(options.symbol).toUpperCase() : state.symbol;
    if (symbol && symbol !== state.symbol) {
      state.symbol = symbol;
      state.data = null;
    }
    if (!state.symbol && $("rsym")) state.symbol = $("rsym").textContent.trim() || "SPY";
    if (state.symbol) setText("rsym", state.symbol);
    renderSymbol();
    renderMarket();
    loadSymbol(false);
    loadMarket(false);
  }

  function setSymbol(symbol, edgeApi) {
    if (edgeApi) state.edge = edgeApi;
    const s = String(symbol || "").toUpperCase();
    if (!s || s === state.symbol) return;
    state.symbol = s;
    state.data = null;
    state.error = "";
    setText("rwhen", "");
    showError("");
    setText("rsym", s);
    renderSymbol();
    if (visible()) loadSymbol(true);
  }

  function reload() {
    loadSymbol(true);
    loadMarket(true);
  }

  const run = $("rrun");
  if (run) run.addEventListener("click", reload);

  window.DeskResearch = { open, setSymbol, reload, setEdge: (v) => { state.edge = v || ""; }, visible };
})();
