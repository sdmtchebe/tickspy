"""volatility_predictor.py

Two-stage volatility forecaster for the Desk dashboard.

Stage 1 (statistical filter)
    Garman-Klass realized volatility (RV_GK) from OHLC bars, HAR(1,5,22)
    components, and a GARCH(1,1) fit on log returns. HAR is fit with an
    expanding walk-forward so every one-step forecast is out-of-sample.
    Stage-1 output: a linear volatility forecast and residuals
    e_t = RV_t - RV_hat_t.

Stage 2 (LSTM)
    A PyTorch LSTM (2 x 64 units, dropout 0.2, linear head) is trained on
    RobustScaler-scaled sequences (lookback 30) of [residual, ATR%, return,
    relative volume, volume z-score] to correct the linear forecast and read
    the next bar's directional bias.

Reliability measures
    - Chronological hold-out backtest, optionally a strict multi-fold
      expanding walk-forward (`strict=True`).
    - Stage-2 auto-gating: the LSTM correction is scaled by the skill it
      actually demonstrated out of sample. A model that adds nothing
      contributes nothing.
    - An uncertainty band derived from the out-of-sample error.
    - Session-boundary masking so the overnight gap cannot poison ATR or the
      return feature.
    - Data-quality checks (duplicate bars, stale feed, too few sessions).

IMPORTANT - NOT INVESTMENT ADVICE
    This module produces statistical estimates for educational and research
    use. It is not investment advice, not a recommendation to buy or sell any
    security, and it carries no guarantee of accuracy. Model output can be
    wrong, and historical or hypothetical results do not indicate future
    results. See DISCLAIMER.md. Do not rely on it for trading decisions.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import RobustScaler
import torch
import torch.nn as nn

try:  # arch is required by the spec but we degrade gracefully if it is absent.
    from arch import arch_model

    _HAS_ARCH = True
except Exception:  # pragma: no cover - import guard
    arch_model = None
    _HAS_ARCH = False


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

LOOKBACK = 30          # rolling sequence length for the LSTM
HIDDEN = 64            # LSTM hidden units
LAYERS = 2             # stacked LSTM layers
DROPOUT = 0.2          # dropout between layers and on the head
SEED = 7               # determinism
MIN_BARS = 120         # below this a two-stage fit is not meaningful
HAR_MIN_TRAIN = 40     # first index that gets an expanding-window HAR forecast
DIR_NEUTRAL_Q = 0.60   # neutral band = 60th percentile of |return| (adaptive)
DIR_THRESHOLD = 0.02   # floor for that band, in percent
MAX_EPOCHS = 90
PATIENCE = 12
BATCH = 128            # training batch (large: histories can be ~20k bars)
MAX_TRAIN_SEQ = 4000   # cap training sequences so long histories stay fast
MAX_VAL_SEQ = 1200     # cap the early-stopping set for the same reason
VAL_FRAC = 0.15        # tail of the training window used for early stopping
TEST_FRAC = 0.20       # held-out tail used for the single-split backtest
VOL_WIN = 20           # window for the relative-volume features
STAGE2_FULL_IMPROVE = 5.0  # % RMSE gain over stage 1 that earns the LSTM full weight

# (train_frac, eval_to_frac) for the strict expanding walk-forward.
STRICT_FOLDS = ((0.55, 0.70), (0.70, 0.85), (0.85, 1.00))

_LN2 = math.log(2.0)


# --------------------------------------------------------------------------- #
# Small numeric helpers
# --------------------------------------------------------------------------- #

def _finite(x) -> bool:
    try:
        return bool(np.isfinite(float(x)))
    except Exception:
        return False


def _f(x, default: float = 0.0) -> float:
    """Coerce anything (numpy scalar, nan) to a plain JSON-safe float."""
    try:
        v = float(x)
        return v if math.isfinite(v) else float(default)
    except Exception:
        return float(default)


def _clean(x: np.ndarray) -> np.ndarray:
    """Replace nan/inf with 0 so scalers and the network never see bad values."""
    return np.nan_to_num(np.asarray(x, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)


def _rolling_mean(a: np.ndarray, w: int) -> np.ndarray:
    return pd.Series(a, dtype="float64").rolling(w, min_periods=w).mean().to_numpy()


def _rolling_std(a: np.ndarray, w: int) -> np.ndarray:
    return pd.Series(a, dtype="float64").rolling(w, min_periods=w).std().to_numpy()


def garman_klass(o, h, l, c) -> np.ndarray:
    """Per-bar Garman-Klass volatility, expressed in percent.

    GK variance = 0.5*ln(H/L)^2 - (2*ln2 - 1)*ln(C/O)^2. Negative estimates
    are clipped to zero before the square root.
    """
    hl = np.log(np.maximum(h, 1e-12) / np.maximum(l, 1e-12))
    co = np.log(np.maximum(c, 1e-12) / np.maximum(o, 1e-12))
    var = 0.5 * hl * hl - (2.0 * _LN2 - 1.0) * co * co
    return np.sqrt(np.clip(var, 0.0, None)) * 100.0


# --------------------------------------------------------------------------- #
# Data ingestion
# --------------------------------------------------------------------------- #

_ALIASES = {
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c", "adjclose", "adj_close"),
    "volume": ("volume", "v"),
    "timestamp": ("timestamp", "t", "time", "date", "datetime"),
}


def to_ohlcv(df: pd.DataFrame, drop_duplicates: bool = True) -> pd.DataFrame:
    """Normalise an arbitrary OHLCV frame to lowercase open/high/low/close/volume.

    Accepts long or short column names and an optional timestamp column, which
    becomes a DatetimeIndex so results can be charted against time. Duplicate
    timestamps (a sign of a paginated fetch overlapping) are dropped.
    """
    if df is None:
        raise ValueError("No data supplied.")
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    if df.empty:
        raise ValueError("Data frame is empty.")

    lowered = {str(c).strip().lower(): c for c in df.columns}
    chosen: dict[str, Any] = {}
    for canon, names in _ALIASES.items():
        for n in names:
            if n in lowered:
                chosen[canon] = lowered[n]
                break

    missing = [k for k in ("open", "high", "low", "close") if k not in chosen]
    if missing:
        raise ValueError("OHLCV frame is missing column(s): " + ", ".join(missing))

    out = pd.DataFrame(index=df.index)
    for canon in ("open", "high", "low", "close"):
        out[canon] = pd.to_numeric(df[chosen[canon]], errors="coerce")
    out["volume"] = (
        pd.to_numeric(df[chosen["volume"]], errors="coerce").fillna(0.0)
        if "volume" in chosen
        else 0.0
    )

    ts = None
    if "timestamp" in chosen:
        ts = pd.to_datetime(df[chosen["timestamp"]], errors="coerce", utc=True)
    elif isinstance(df.index, pd.DatetimeIndex):
        ts = pd.to_datetime(df.index, errors="coerce", utc=True)

    out = out.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    if ts is not None:
        ts = pd.Series(ts).reset_index(drop=True)
        ts = ts[ts.notna()].reset_index(drop=True)
        if len(ts) == len(out):
            out.index = pd.DatetimeIndex(ts)
    if drop_duplicates and isinstance(out.index, pd.DatetimeIndex):
        out = out[~out.index.duplicated(keep="last")]
    if len(out) < MIN_BARS:
        raise ValueError(
            f"Need at least {MIN_BARS} usable bars for a two-stage fit, got {len(out)}."
        )
    return out


def _session_boundary(index) -> np.ndarray:
    """True where a bar starts a new trading session (the overnight gap lives there)."""
    n = len(index)
    if not n:
        return np.zeros(0, dtype=bool)
    if isinstance(index, pd.DatetimeIndex):
        try:
            et = index.tz_convert("America/New_York") if index.tz is not None else index
            days = np.array([d.date() for d in et])
            b = np.zeros(n, dtype=bool)
            b[1:] = days[1:] != days[:-1]
            return b
        except Exception:
            pass
    return np.zeros(n, dtype=bool)


def _data_quality(bars: pd.DataFrame, boundary: np.ndarray) -> dict:
    """Cheap sanity checks surfaced to the caller instead of silently ignored."""
    n = len(bars)
    dq = {"bars": int(n), "sessions": int(boundary.sum()) + 1, "duplicate_timestamps": 0,
          "stale": False, "last_gap_seconds": None}
    if isinstance(bars.index, pd.DatetimeIndex) and n > 3:
        try:
            dq["duplicate_timestamps"] = int(bars.index.duplicated().sum())
            secs = np.diff(bars.index.astype("int64").to_numpy()) / 1e9
            med = float(np.median(secs)) if len(secs) else 0.0
            last = float(secs[-1])
            dq["last_gap_seconds"] = round(last, 1)
            # A last gap far larger than the typical bar spacing means the feed
            # stopped or the history is truncated mid-session.
            dq["stale"] = bool(med > 0 and last > max(300.0, med * 20))
        except Exception:
            pass
    return dq


# --------------------------------------------------------------------------- #
# Stage 1: HAR (expanding walk-forward) + GARCH(1,1)
# --------------------------------------------------------------------------- #

def _har_design(rv: np.ndarray) -> np.ndarray:
    """Design matrix for target time t using information available at t-1."""
    n = len(rv)
    X = np.full((n, 4), np.nan)
    for t in range(22, n):
        X[t, 0] = 1.0
        X[t, 1] = rv[t - 1]
        X[t, 2] = rv[t - 5:t].mean()
        X[t, 3] = rv[t - 22:t].mean()
    return X


def har_walk_forward(rv: np.ndarray, min_train: int = HAR_MIN_TRAIN,
                     refit_every: Optional[int] = None):
    """One-step-ahead HAR forecasts, each fit only on prior data.

    Returns (X, lin) where `lin[t]` is the out-of-sample prediction of rv[t].
    Coefficients are refreshed at most ~400 times across the sample so a 20k-bar
    history stays fast; between refits the previous (already out-of-sample) fit
    is reused, which never lets a forecast see data from its own future.
    """
    n = len(rv)
    X = _har_design(rv)
    lin = np.full(n, np.nan)
    if refit_every is None:
        refit_every = max(1, n // 400)
    beta = None
    for t in range(min_train, n):
        if beta is None or (t - min_train) % refit_every == 0:
            xtr, ytr = X[:t], rv[:t]
            m = np.isfinite(xtr).all(axis=1) & np.isfinite(ytr)
            if m.sum() < 20:
                continue
            try:
                beta, *_ = np.linalg.lstsq(xtr[m], ytr[m], rcond=None)
            except np.linalg.LinAlgError:
                beta = None
                continue
        if beta is not None:
            lin[t] = float(X[t] @ beta)
    return X, lin


def _har_next(rv: np.ndarray) -> tuple[float, float]:
    """Final full-sample HAR fit -> next-bar forecast and OLS residual std."""
    X = _har_design(rv)
    m = np.isfinite(X).all(axis=1) & np.isfinite(rv)
    if m.sum() < 20:
        return float(np.nan), float(np.nan)
    beta, *_ = np.linalg.lstsq(X[m], rv[m], rcond=None)
    nxt = np.array([1.0, rv[-1], rv[-5:].mean(), rv[-22:].mean()])
    resid = rv[m] - X[m] @ beta
    return float(nxt @ beta), float(np.std(resid))


def garch_next(r: np.ndarray) -> float:
    """GARCH(1,1) one-step volatility forecast, in percent of price."""
    if not _HAS_ARCH:
        return float("nan")
    r = np.asarray(r, dtype="float64")
    r = r[np.isfinite(r)]  # the first log-return is NaN; arch rejects non-finite input
    if len(r) < 50 or np.std(r) <= 0:
        return float("nan")
    try:
        am = arch_model(r, mean="Constant", vol="GARCH", p=1, o=0, q=1,
                        dist="normal", rescale=False)
        res = am.fit(disp="off", show_warning=False, options={"maxiter": 200})
        fc = res.forecast(horizon=1, reindex=False)
        var = float(np.asarray(fc.variance).ravel()[-1])
        return math.sqrt(max(var, 0.0))
    except Exception:
        return float("nan")


# --------------------------------------------------------------------------- #
# Stage 2: LSTM
# --------------------------------------------------------------------------- #

class VolatilityLSTM(nn.Module):
    """2x64 LSTM with dropout and a single linear head.

    The head emits four values: a residual correction followed by three
    directional logits (bearish / neutral / bullish).
    """

    def __init__(self, n_features: int, hidden: int = HIDDEN, layers: int = LAYERS,
                 dropout: float = DROPOUT):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=n_features,
            hidden_size=hidden,
            num_layers=layers,
            batch_first=True,
            dropout=dropout if layers > 1 else 0.0,
        )
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, 4)

    def forward(self, x):
        out, _ = self.lstm(x)
        h = self.drop(out[:, -1, :])
        y = self.head(h)
        return y[:, 0], y[:, 1:]


def _dir_labels(r: np.ndarray, thr: float = DIR_THRESHOLD) -> np.ndarray:
    """0 = bearish, 1 = neutral, 2 = bullish."""
    lab = np.ones(len(r), dtype=np.int64)
    lab[r > thr] = 2
    lab[r < -thr] = 0
    return lab


def _build_sequences(X: np.ndarray, res: np.ndarray, dirs: np.ndarray,
                     positions: np.ndarray, lookback: int):
    xs, yr, yd = [], [], []
    for j in positions:
        xs.append(X[j - lookback:j])
        yr.append(res[j])
        yd.append(dirs[j])
    return (np.asarray(xs, dtype=np.float32),
            np.asarray(yr, dtype=np.float32),
            np.asarray(yd, dtype=np.int64))


def _train_lstm(feats: np.ndarray, res: np.ndarray, dirs: np.ndarray,
                lookback: int = LOOKBACK, hidden: int = HIDDEN,
                layers: int = LAYERS, dropout: float = DROPOUT,
                seed: int = SEED, batch: int = BATCH,
                train_frac: float = 1.0 - TEST_FRAC, eval_to: float = 1.0,
                log: Optional[list] = None):
    """Fit stage 2 and evaluate it chronologically out of sample.

    `train_frac` / `eval_to` carve the evaluation window: the model trains only
    on positions before `train_frac` and predicts the window up to `eval_to`.
    Returns a dict with the fitted model, scaler, residual scaling, the test
    region predictions, and warnings. Raises ValueError when there is not
    enough usable history.
    """
    warnings = log if log is not None else []
    N = len(feats)
    valid = (np.isfinite(feats).all(axis=1) & np.isfinite(res) & np.isfinite(dirs))
    positions = np.array([j for j in range(lookback, N) if valid[j]
                          and np.isfinite(feats[j - lookback:j]).all()])
    if len(positions) < 80:
        raise ValueError("Not enough clean sequences to train the LSTM.")

    split_pos = int(len(positions) * train_frac)
    test_end = int(len(positions) * eval_to)
    train_pos = positions[:split_pos]
    test_pos = positions[split_pos:test_end]
    if len(train_pos) < 40 or len(test_pos) < 5:
        raise ValueError("Train/test split too small for the LSTM.")

    scaler = RobustScaler().fit(feats[np.isfinite(feats).all(axis=1)])
    Xs = scaler.transform(_clean(feats)).astype(np.float32)

    res_mu = float(np.mean(res[train_pos]))
    res_sd = float(np.std(res[train_pos])) or 1.0
    res_scaled = (res - res_mu) / res_sd

    # Early-stopping split comes off the tail of the training region only.
    val_n = max(8, int(len(train_pos) * VAL_FRAC))
    fit_pos = train_pos[:-val_n]
    val_pos = train_pos[-val_n:]

    # Cap both sets with an even stride so a 20k-bar history trains in seconds.
    if len(fit_pos) > MAX_TRAIN_SEQ:
        fit_pos = fit_pos[np.linspace(0, len(fit_pos) - 1, MAX_TRAIN_SEQ).astype(int)]
    if len(val_pos) > MAX_VAL_SEQ:
        val_pos = val_pos[-MAX_VAL_SEQ:]

    Xt, Yt, Dt = _build_sequences(Xs, res_scaled, dirs, fit_pos, lookback)
    Xv, Yv, Dv = _build_sequences(Xs, res_scaled, dirs, val_pos, lookback)
    if len(Xt) < 20 or len(Xv) < 4:
        raise ValueError("Not enough sequences after the val split.")

    torch.manual_seed(seed)
    np.random.seed(seed)
    model = VolatilityLSTM(feats.shape[1], hidden, layers, dropout)
    opt = torch.optim.Adam(model.parameters(), lr=5e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=4)

    # Unweighted, the direction head collapses to "neutral" on every bar (the
    # majority class) and hides the fact that it has no edge. Weight inversely to
    # class frequency so it makes real calls, then report balanced accuracy so
    # any lack of skill is visible rather than masked.
    counts = np.bincount(Dt, minlength=3).astype(float)
    w = np.clip(counts.sum() / np.maximum(counts * 3.0, 1.0), 0.2, 5.0)
    ce = nn.CrossEntropyLoss(weight=torch.from_numpy(w.astype(np.float32)))

    Xt_t, Yt_t, Dt_t = torch.from_numpy(Xt), torch.from_numpy(Yt), torch.from_numpy(Dt)
    Xv_t, Yv_t, Dv_t = torch.from_numpy(Xv), torch.from_numpy(Yv), torch.from_numpy(Dv)

    best_state, best_val, bad = None, float("inf"), 0
    for _ in range(MAX_EPOCHS):
        model.train()
        perm = np.random.permutation(len(Xt_t))
        for b in range(0, len(perm), batch):
            idx = perm[b:b + batch]
            opt.zero_grad()
            rp, dl = model(Xt_t[idx])
            loss = nn.functional.mse_loss(rp, Yt_t[idx]) + 0.5 * ce(dl, Dt_t[idx])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        model.eval()
        with torch.no_grad():
            rp, dl = model(Xv_t)
            vl = (nn.functional.mse_loss(rp, Yv_t).item()
                  + 0.5 * ce(dl, Dv_t).item())
        sched.step(vl)
        if vl < best_val - 1e-6:
            best_val = vl
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            bad = 0
        else:
            bad += 1
            if bad >= PATIENCE:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()

    # Out-of-sample pass over the held-out window (no refitting).
    Xte, _, _ = _build_sequences(Xs, res_scaled, dirs, test_pos, lookback)
    with torch.no_grad():
        rp, dl = model(torch.from_numpy(Xte))
        res_pred = rp.numpy() * res_sd + res_mu
        dir_prob = torch.softmax(dl, dim=1).numpy()
        dir_pred = dir_prob.argmax(axis=1)
    return {
        "model": model,
        "scaler": scaler,
        "res_mu": res_mu,
        "res_sd": res_sd,
        "positions": positions,
        "test_pos": test_pos,
        "res_pred": res_pred,
        "dir_prob": dir_prob,
        "dir_pred": dir_pred,
        "val_loss": best_val,
    }


# --------------------------------------------------------------------------- #
# Result type
# --------------------------------------------------------------------------- #

@dataclass
class PredictionResult:
    symbol: str
    predicted_volatility: float           # percent per bar, stage 1 + gated stage 2
    direction_signal: str                 # bullish / bearish / neutral (low reliability)
    regime: str                           # one of the three regime labels
    linear_volatility: float              # stage-1 HAR forecast
    residual_correction: float            # stage-2 LSTM residual actually applied
    garch_volatility: float               # GARCH(1,1) cross-check
    current_volatility: float             # latest realized RV_GK
    vol_percentile: float                 # where the forecast sits in RV history
    direction_confidence: float           # softmax confidence of the direction call
    stage2_weight: float                  # 0..1 weight the LSTM earned out of sample
    lstm_raw_residual: float              # unweighted LSTM output, for transparency
    vol_low: float                        # uncertainty band lower edge
    vol_high: float                       # uncertainty band upper edge
    regime_reason: str
    bars: int
    as_of: str
    model: str
    periods_per_year: Optional[float]
    predicted_vol_annual_pct: Optional[float]
    current_vol_annual_pct: Optional[float]
    backtest: dict = field(default_factory=dict)
    series: dict = field(default_factory=dict)
    data_quality: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    direction_edge: str = "unknown"   # none | weak | usable, from balanced accuracy
    reliable: bool = False            # volatility forecast beats the naive baseline
    strict: bool = False              # whether the strict multi-fold backtest was used

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------- #
# Predictor
# --------------------------------------------------------------------------- #

class VolatilityPredictor:
    def __init__(self, lookback: int = LOOKBACK, hidden: int = HIDDEN,
                 layers: int = LAYERS, dropout: float = DROPOUT, seed: int = SEED):
        self.lookback = lookback
        self.hidden = hidden
        self.layers = layers
        self.dropout = dropout
        self.seed = seed

    # -- feature engineering ------------------------------------------------- #
    def build_features(self, df: pd.DataFrame) -> dict:
        o = df["open"].to_numpy(float)
        h = df["high"].to_numpy(float)
        l = df["low"].to_numpy(float)
        c = df["close"].to_numpy(float)
        v = df["volume"].to_numpy(float)
        n = len(c)

        # The overnight gap is one huge bar-to-bar return per session. Left in, it
        # dominates both ATR and the LSTM's return feature, so cross-session moves
        # are masked out and boundary true range uses the intra-bar range only.
        boundary = _session_boundary(df.index)
        r = np.full(n, np.nan)
        r[1:] = np.log(c[1:] / c[:-1]) * 100.0
        r[boundary] = np.nan
        rv = garman_klass(o, h, l, c)

        prev_close = np.concatenate([[c[0]], c[:-1]])
        tr = np.maximum(h - l, np.maximum(np.abs(h - prev_close), np.abs(l - prev_close)))
        tr[boundary] = (h - l)[boundary]
        atr = _rolling_mean(tr, 14)
        atr_pct = atr / np.maximum(c, 1e-12) * 100.0

        # Volume features. Stage 1 ignores them (GK is pure price/range), but the
        # LSTM is handed both so it can learn whether participation confirms a
        # move. This was a real gap in the first version.
        vmean = _rolling_mean(v, VOL_WIN)
        vstd = _rolling_std(v, VOL_WIN)
        rel_vol = v / np.maximum(vmean, 1e-9)
        vol_z = (v - vmean) / np.maximum(vstd, 1e-9)

        X, lin = har_walk_forward(rv)
        resid = rv - lin
        gk5 = _rolling_mean(rv, 5)
        gk22 = _rolling_mean(rv, 22)

        # An adaptive neutral band keeps the direction classes from collapsing
        # (almost every 1-minute SPY bar moves < 0.05%, which would make a fixed
        # threshold predict "neutral" for ~93% of bars). Fit on the first 80% so
        # the threshold itself never uses the test window.
        finite_abs = np.abs(r[np.isfinite(r)])
        if len(finite_abs) > 40:
            head = finite_abs[:int(len(finite_abs) * 0.8)]
            dir_thr = max(DIR_THRESHOLD, float(np.quantile(head, DIR_NEUTRAL_Q)))
        else:
            dir_thr = DIR_THRESHOLD
        dirs = _dir_labels(r, dir_thr)

        feats = np.column_stack([resid, atr_pct, r, rel_vol, vol_z]).astype(float)
        return {
            "close": c, "ret": r, "rv": rv, "lin": lin, "resid": resid,
            "atr_pct": atr_pct, "rel_vol": rel_vol, "vol_z": vol_z,
            "rv5": gk5, "rv22": gk22, "dirs": dirs, "dir_thr": dir_thr,
            "feats": feats, "n": n, "boundary": boundary,
        }

    # -- regime -------------------------------------------------------------- #
    def _regime(self, pred: float, cur: float, hist: np.ndarray):
        pct = float(np.mean(hist <= pred)) if len(hist) else 0.5
        squeeze = cur <= float(np.quantile(hist, 0.35)) if len(hist) > 5 else False
        if squeeze and pred > cur * 1.12:
            return ("Breakout Risk",
                    f"Volatility is in the bottom third of its recent range "
                    f"({_f(pct * 100, 50):.0f}th pct) but the forecast is rising "
                    f"({_f(cur, 0):.2f}% -> {_f(pred, 0):.2f}%), the classic "
                    f"squeeze-then-expansion setup.")
        if pct >= 0.70 or pred > cur * 1.30:
            return ("High Volatility Expansion",
                    f"The forecast sits in the {_f(pct * 100, 50):.0f}th percentile "
                    f"of recent realized volatility and is expanding "
                    f"({_f(cur, 0):.2f}% -> {_f(pred, 0):.2f}%).")
        return ("Low Volatility Ranging",
                f"The forecast ({_f(pred, 0):.2f}%) is contained relative to recent "
                f"realized volatility ({_f(pct * 100, 50):.0f}th percentile); "
                f"conditions favour range behaviour over expansion.")

    # -- backtest ------------------------------------------------------------ #
    @staticmethod
    def _backtest(feat: dict, fits: list) -> dict:
        """Pool the held-out windows of one or more fits and score them.

        Pooling lets the strict multi-fold walk-forward report a single set of
        metrics computed over every out-of-sample bar, rather than a flattering
        single window.
        """
        rv, lin, dirs = feat["rv"], feat["lin"], feat["dirs"]
        test_pos = np.concatenate([f["test_pos"] for f in fits])
        res_pred = np.concatenate([f["res_pred"] for f in fits])
        dir_pred = np.concatenate([f["dir_pred"] for f in fits])

        rv_t = rv[test_pos]
        lin_t = lin[test_pos]
        pred_t = lin_t + res_pred
        true_dir = dirs[test_pos]

        def mae(a):
            m = np.isfinite(a)
            return float(np.mean(np.abs(a[m] - rv_t[m]))) if m.any() else float("nan")

        def rmse(a):
            m = np.isfinite(a)
            return float(np.sqrt(np.mean((a[m] - rv_t[m]) ** 2))) if m.any() else float("nan")

        persist = np.array([rv[p - 1] for p in test_pos])
        dir_acc = float(np.mean(dir_pred == true_dir)) if len(true_dir) else float("nan")
        naive = float(np.mean(true_dir == 1)) if len(true_dir) else float("nan")

        # The three-way hit rate is dominated by "neutral", so also report a
        # balanced (per-class) accuracy and a non-neutral-only accuracy. These
        # are the numbers that reveal whether the direction call has any edge.
        classes = (0, 1, 2)
        recalls = []
        for c_ in classes:
            m = true_dir == c_
            recalls.append(float(np.mean(dir_pred[m] == c_)) if m.any() else float("nan"))
        valid_r = [x for x in recalls if math.isfinite(x)]
        macro = float(np.mean(valid_r)) if valid_r else float("nan")
        nn = true_dir != 1
        nna = float(np.mean(dir_pred[nn] == true_dir[nn])) if nn.any() else float("nan")

        r2 = (1.0 - np.nanvar(pred_t - rv_t) / (np.nanvar(rv_t) or np.nan)
              if np.isfinite(np.nanvar(rv_t)) and np.nanvar(rv_t) > 0 else float("nan"))

        return {
            "samples": int(len(test_pos)),
            "vol_mae_linear": mae(lin_t),
            "vol_rmse_linear": rmse(lin_t),
            "vol_mae_combined": mae(pred_t),
            "vol_rmse_combined": rmse(pred_t),
            "vol_rmse_persistence": rmse(persist),
            "direction_accuracy": dir_acc,
            "direction_baseline": naive,
            "direction_balanced_accuracy": macro,
            "direction_nonneutral_accuracy": nna,
            "direction_pred_dist": [float(np.mean(dir_pred == c_)) for c_ in classes],
            "direction_true_dist": [float(np.mean(true_dir == c_)) for c_ in classes],
            "direction_threshold_pct": _f(feat.get("dir_thr"), DIR_THRESHOLD),
            "combined_vs_linear_pct": (
                100.0 * (1 - rmse(pred_t) / rmse(lin_t)) if _finite(rmse(lin_t)) and rmse(lin_t) > 0 else float("nan")
            ),
            "combined_vs_persistence_pct": (
                100.0 * (1 - rmse(pred_t) / rmse(persist)) if _finite(rmse(persist)) and rmse(persist) > 0 else float("nan")
            ),
            "r2_combined": r2,
            "folds": len(fits),
        }

    # -- main ---------------------------------------------------------------- #
    def predict(self, df: pd.DataFrame, symbol: str = "SPY",
                periods_per_year: Optional[float] = None,
                strict: bool = False) -> PredictionResult:
        warnings: list[str] = []
        bars = to_ohlcv(df)
        feat = self.build_features(bars)
        rv = feat["rv"]
        n = feat["n"]
        dq = _data_quality(bars, feat["boundary"])
        if dq["stale"]:
            warnings.append(
                "The most recent bar is much older than the typical bar spacing; "
                "the forecast may be based on a stale feed.")
        if dq["sessions"] < 3:
            warnings.append(
                "Fewer than three trading sessions of history: the volatility "
                "regime estimate is fragile.")
        if dq["duplicate_timestamps"]:
            warnings.append(f"{dq['duplicate_timestamps']} duplicate timestamps were dropped.")

        # Garman-Klass can understate true volatility when bars are sparse (the
        # high/low range never captures the full move). Compare its mean square
        # with squared close-to-close returns so the absolute level is not read
        # as more precise than it is.
        try:
            gk_var = float(np.mean(rv ** 2))
            ret_var = float(np.nanmean(feat["ret"][1:] ** 2))
            ratio = math.sqrt(ret_var / gk_var) if gk_var > 0 else float("nan")
        except Exception:
            ratio = float("nan")
        dq["gk_vs_return_ratio"] = round(ratio, 3) if _finite(ratio) else None
        if _finite(ratio) and (ratio > 1.15 or ratio < 0.85):
            warnings.append(
                f"On these bars Garman-Klass runs {ratio:.2f}x the close-to-close "
                f"return scale, so the absolute volatility level is approximate. "
                f"Relative comparisons (vs the naive baseline) remain meaningful.")

        lin_next, _ = _har_next(rv)
        garch = garch_next(feat["ret"])
        if not _finite(lin_next):
            lin_next = float(rv[-1])
            warnings.append("HAR fit failed; fell back to last realized volatility.")
        if not _finite(garch):
            warnings.append("GARCH(1,1) unavailable; using HAR only.")
        if not _HAS_ARCH:
            warnings.append("The 'arch' package is not installed; GARCH was skipped.")

        residual = 0.0
        raw_residual = 0.0
        stage2_w = 0.0
        direction = "neutral"
        confidence = 0.0
        bt: dict = {}
        series: dict = {}
        fits: list = []
        try:
            windows = STRICT_FOLDS if strict else ((1.0 - TEST_FRAC, 1.0),)
            for train_frac, eval_to in windows:
                fits.append(_train_lstm(
                    feat["feats"], feat["resid"], feat["dirs"],
                    self.lookback, self.hidden, self.layers, self.dropout,
                    self.seed, log=warnings, train_frac=train_frac, eval_to=eval_to))
            bt = self._backtest(feat, fits)

            # Stage-2 auto-gating. The LSTM only gets to move the forecast in
            # proportion to the RMSE improvement it actually delivered out of
            # sample. On real 1-minute SPY data it usually earns close to zero,
            # which is the honest outcome and stops it from adding pure noise.
            imp = bt.get("combined_vs_linear_pct")
            if _finite(imp) and imp > 0:
                stage2_w = float(min(1.0, imp / STAGE2_FULL_IMPROVE))
            if stage2_w <= 0:
                warnings.append(
                    "Stage 2 added no measurable accuracy out of sample, so its "
                    "correction was weighted to zero and the forecast is "
                    "effectively stage 1 only.")

            # Live one-step-ahead read using the final fold's model.
            fit = fits[-1]
            last_pos = int(fit["positions"][-1])
            seq = fit["scaler"].transform(
                _clean(feat["feats"][last_pos - self.lookback:last_pos])
            ).astype(np.float32)[None, :, :]
            with torch.no_grad():
                rp, dl = fit["model"](torch.from_numpy(seq))
                prob = torch.softmax(dl, dim=1).numpy()[0]
            raw_residual = float(rp.numpy()[0]) * fit["res_sd"] + fit["res_mu"]
            cap = 0.5 * abs(lin_next) if lin_next else 0.0
            if cap and abs(raw_residual) > cap:
                raw_residual = float(np.sign(raw_residual) * cap)
                warnings.append("LSTM residual clipped to +/-50% of the linear forecast.")
            residual = stage2_w * raw_residual
            cls = int(prob.argmax())
            direction = ("bearish", "neutral", "bullish")[cls]
            confidence = float(prob[cls])

            # Chart series: realized vs HAR vs combined over the pooled test window.
            tail = np.sort(np.concatenate([f["test_pos"] for f in fits]))[-160:]
            res_by_pos = {}
            for f in fits:
                for p, r_ in zip(f["test_pos"], f["res_pred"]):
                    res_by_pos[int(p)] = float(r_)
            idx_vals = bars.index[tail] if isinstance(bars.index, pd.DatetimeIndex) else tail
            series = {
                "labels": [str(x) for x in idx_vals],
                "realized": [round(_f(v), 5) for v in rv[tail]],
                "linear": [round(_f(v), 5) for v in feat["lin"][tail]],
                "combined": [round(_f(feat["lin"][p] + res_by_pos.get(int(p), 0.0)), 5)
                             for p in tail],
            }
        except Exception as exc:  # keep stage 1 alive if stage 2 fails
            warnings.append(f"LSTM stage skipped: {exc}")

        pred = max(0.0, lin_next + residual)
        cur = float(rv[-1])
        pct = float(np.mean(rv <= pred))
        band = _f(bt.get("vol_rmse_combined")) if bt else 0.0
        regime, reason = self._regime(pred, cur, rv)
        ann = lambda v: _f(v) * math.sqrt(periods_per_year) if periods_per_year else None

        ba = bt.get("direction_balanced_accuracy") if bt else None
        edge = "unknown"
        if ba is not None and _finite(ba):
            edge = "usable" if ba >= 0.45 else ("weak" if ba >= 0.38 else "none")
        improve = bt.get("combined_vs_persistence_pct") if bt else None
        reliable = bool(_finite(improve) and improve > 5.0 and bt.get("samples", 0) >= 200)

        return PredictionResult(
            symbol=str(symbol).upper(),
            predicted_volatility=round(pred, 5),
            direction_signal=direction,
            regime=regime,
            linear_volatility=round(float(lin_next), 5),
            residual_correction=round(float(residual), 6),
            garch_volatility=round(_f(garch), 5),
            current_volatility=round(cur, 5),
            vol_percentile=round(pct, 4),
            direction_confidence=round(confidence, 4),
            stage2_weight=round(stage2_w, 4),
            lstm_raw_residual=round(float(raw_residual), 6),
            vol_low=round(max(0.0, pred - band), 5),
            vol_high=round(pred + band, 5),
            regime_reason=reason,
            bars=int(n),
            as_of=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            model=f"HAR(1,5,22) + GARCH(1,1) -> LSTM({HIDDEN}x{LAYERS})",
            periods_per_year=periods_per_year,
            predicted_vol_annual_pct=(round(ann(pred), 3) if periods_per_year else None),
            current_vol_annual_pct=(round(ann(cur), 3) if periods_per_year else None),
            backtest=bt,
            series=series,
            data_quality=dq,
            warnings=warnings,
            direction_edge=edge,
            reliable=reliable,
            strict=bool(strict),
        )


# --------------------------------------------------------------------------- #
# Cached convenience entry point (used by the dashboard server)
# --------------------------------------------------------------------------- #

_CACHE: dict = {}
_LOCK = __import__("threading").Lock()
_TTL = 45.0  # seconds; avoids retraining the LSTM on every browser refresh


def predict_cached(df: pd.DataFrame, symbol: str = "SPY",
                   timeframe: str = "1Min",
                   periods_per_year: Optional[float] = None,
                   strict: bool = False, ttl: float = _TTL,
                   force: bool = False) -> dict:
    """Cached `VolatilityPredictor.predict`, returning a plain dict.

    The cache key includes the symbol, timeframe and the last bar timestamp, so
    a new bar triggers a refit while repeated views inside `ttl` reuse the model.
    """
    key = (str(symbol).upper(), str(timeframe), bool(strict))
    sig = None
    try:
        if isinstance(df.index, pd.DatetimeIndex) and len(df.index):
            sig = str(df.index[-1])
        elif "t" in df.columns and len(df):
            sig = str(df["t"].iloc[-1])
    except Exception:
        sig = None

    with _LOCK:
        hit = _CACHE.get(key)
        if (hit and not force and hit["sig"] == sig
                and (time.time() - hit["at"]) < ttl):
            out = dict(hit["result"])
            out["cached"] = True
            return out

    predictor = VolatilityPredictor()
    result = predictor.predict(df, symbol=symbol,
                               periods_per_year=periods_per_year, strict=strict)
    payload = result.to_dict()
    payload["cached"] = False
    with _LOCK:
        _CACHE[key] = {"sig": sig, "at": time.time(), "result": payload}
    return payload


# --------------------------------------------------------------------------- #
# Self test
# --------------------------------------------------------------------------- #

def _synthetic_ohlcv(n: int = 900, seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    # Two volatility regimes so the backtest has something to find.
    vol = np.where(np.arange(n) < n // 2, 0.0012, 0.0035)
    ret = rng.normal(0.0, 1.0, n) * vol
    close = 100.0 * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[100.0], close[:-1]])
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0, 0.0006, n)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0, 0.0006, n)))
    volume = rng.integers(50_000, 500_000, n)
    ts = pd.date_range("2026-01-02 09:30", periods=n, freq="1min")
    return pd.DataFrame({"t": ts, "o": open_, "h": high, "l": low,
                         "c": close, "v": volume})


if __name__ == "__main__":
    import json

    df = _synthetic_ohlcv()
    t0 = time.time()
    out = VolatilityPredictor().predict(df, symbol="SYNTH", periods_per_year=390 * 252)
    dt = time.time() - t0

    print(f"fit time: {dt:.2f}s")
    print(f"predicted vol : {out.predicted_volatility:.4f}%  "
          f"(band {out.vol_low:.4f}-{out.vol_high:.4f})")
    print(f"stage-2 weight: {out.stage2_weight:.2f}   "
          f"(raw LSTM {out.lstm_raw_residual:+.5f})")
    print(f"direction     : {out.direction_signal} (conf {out.direction_confidence:.2f}, "
          f"edge {out.direction_edge})")
    print(f"regime        : {out.regime}")
    print(f"reliable      : {out.reliable}")
    print("backtest      :", json.dumps(out.backtest, indent=2))
    print("data quality  :", out.data_quality)
    print("warnings      :", out.warnings or "none")
