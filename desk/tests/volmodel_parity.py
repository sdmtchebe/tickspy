"""Reference side of the browser volatility port parity check.

Runs the real Python model (volatility_predictor.py) on a bars JSON file and
prints the stage-1 numbers the browser engine is supposed to reproduce.

This is a development harness, not part of the shipped desk. It needs the full
server stack (pandas, scikit-learn, torch, arch):

    python3 desk/tests/volmodel_parity.py /tmp/desk_bars.json
"""

import json
import pathlib
import sys

DESK = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DESK))

import pandas as pd  # noqa: E402

from volatility_predictor import VolatilityPredictor  # noqa: E402

FIELDS = (
    "samples",
    "vol_rmse_linear",
    "vol_rmse_persistence",
    "vol_rmse_combined",
    "direction_threshold_pct",
    "r2_combined",
    "combined_vs_persistence_pct",
)


def main() -> None:
    bars = json.load(open(sys.argv[1]))
    df = pd.DataFrame(bars)
    out = VolatilityPredictor().predict(df, symbol="SYNTH", periods_per_year=390 * 252)
    bt = out.backtest or {}
    payload = {
        "linear_volatility": out.linear_volatility,
        "garch_volatility": out.garch_volatility,
        "current_volatility": out.current_volatility,
        "vol_percentile": out.vol_percentile,
        "pct_stage2_weight": out.stage2_weight,
        "regime": out.regime,
        "backtest": {k: bt.get(k) for k in FIELDS},
        "series_len": len((out.series or {}).get("realized", [])),
        "bars": out.bars,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
