# Netlify Scheduled Function Tutorial — Daily HF Data Library Refresh

This guide explains how to configure the daily automatic data refresh for TickSPY's free mode using Netlify Scheduled Functions.

---

## Overview

The free mode shows the previous completed trading session replayed as if live. Data comes from **HF Data Library (IEX exchange data, CC BY 4.0)**. The scheduled function:

1. Runs daily at **06:00 UTC** (after US market close, before EU open)
2. Downloads latest 1-min IEX bars for configured tickers from HF Data Library
3. Converts to desk-ready JSON (intraday + daily bars, session detection)
4. Commits updated files to your GitHub repo (`desk/hfdata/*.json`)
5. Triggers a new Netlify build with fresh data

---

## Prerequisites

### 1. HF Data Library API Key
- Sign up at https://hfdatalibrary.com (free, academic/research use)
- Get your API key from the dashboard
- **Key expires every 30 days** — you'll need to update it monthly in Netlify env vars

### 2. GitHub Personal Access Token (PAT)
- Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Create token with:
  - **Repository access**: Select your repo (e.g., `sdmtchebe/tickspy`)
  - **Permissions**: Contents → Read and write
- Copy the token (you won't see it again)

### 3. Repository
- Your TickSPY repo must be on GitHub (e.g., `sdmtchebe/tickspy`)
- The `main` branch must exist and be the default branch

---

## Step-by-Step Setup

### 1. Deploy to Netlify (if not already)

```bash
# Build and deploy
cd frontend
npm run build
netlify deploy --prod --dir=../TickSPY-Netlify-Release
```

Or connect your repo in Netlify dashboard for automatic builds.

### 2. Configure Environment Variables

In Netlify Dashboard → **Site settings** → **Environment variables**, add:

| Variable | Value | Description |
|----------|-------|-------------|
| `HF_DATA_KEY` | `your-hfdatalibrary-api-key` | From hfdatalibrary.com dashboard |
| `GH_TOKEN` | `github_pat_...` | Fine-grained PAT with repo:write |
| `GH_REPO` | `sdmtchebe/tickspy` | Your GitHub repo in owner/repo format |
| `HF_TICKERS` | `["SPY","QQQ","AAPL","NVDA","TSLA","MSFT","META","GOOGL","AMZN","AMD"]` | Optional JSON array to customize tickers |

**Important**: After adding env vars, trigger a new deploy so the function picks them up.

### 3. Verify the Function Works

In Netlify Dashboard → **Functions** → **update-hfdata** → **Invoke**:

- Check the function logs for download progress
- Should show: `Downloading SPY...`, `Parsed 20000+ bars for SPY`, etc.
- On success: `committed: true` and a new commit appears in your GitHub repo
- Netlify will auto-build and deploy the updated site

### 4. Check the Schedule

The function runs daily at **06:00 UTC** (defined in `netlify.toml`):

```toml
[functions.schedule]
  "update-hfdata" = "0 6 * * *"
```

To change the schedule, edit `netlify.toml` and redeploy. Cron format: `minute hour day month weekday` (UTC).

---

## How It Works

### Function Code: `frontend/netlify/functions/update-hfdata.js`

Key sections:

```javascript
// 1. Downloads Parquet from HF Data Library
async function downloadParquet(symbol, apiKey) { ... }

// 2. Parses Parquet to intraday bars (1-min resolution)
async function parseParquetToBars(parquetBuffer, symbol) { ... }

// 3. Builds daily bars + finds last 3 complete sessions
function buildDailyBars(intradayBars) { ... }
function findSessions(intradayBars) { ... }

// 4. Creates desk-ready payload matching freesrc.js expectations
function buildPayload(symbol, intradayBars) { ... }

// 5. Commits to GitHub via git
async function commitFiles(ghToken, ghRepo, files, message) { ... }
```

### Output Format

Each `desk/hfdata/SYMBOL.json` contains:

```json
{
  "symbol": "SPY",
  "tf": "5Min",
  "source": "hfdatalibrary",
  "delayed": true,
  "tz": "America/New_York",
  "tzCoverage": 1,
  "sessionDate": "2026-10-09",
  "sessions": 3,
  "asOf": "2026-10-09",
  "bars": [{ "t": "2026-10-09T13:30:00.000Z", "o": 450.12, "h": 450.45, "l": 449.90, "c": 450.23, "v": 12345 }, ...],
  "daily": [{ "t": "2026-10-07T13:30:00.000Z", "o": 448.00, "h": 451.00, "l": 447.50, "c": 450.12, "v": 89000000 }, ...],
  "note": "3 session(s) of 5-minute bars from IEX exchange; the most recent completed session is replayed, delayed end-of-day data. IEX represents ~2-3% of consolidated volume."
}
```

The desk's `freesrc.js` reads this exact format via `/desk/hfdata/SYMBOL.json`.

---

## Customizing Tickers

### Option A: Environment Variable (recommended)

Set `HF_TICKERS` in Netlify env vars as a JSON array:

```json
["SPY","QQQ","AAPL","NVDA","TSLA","MSFT","META","GOOGL","AMZN","AMD","MSTR","COIN"]
```

### Option B: Local Config File

Create `hfdata-tickers.json` in your repo root:

```json
["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT", "META", "GOOGL", "AMZN", "AMD"]
```

The build script and scheduled function both read this file.

---

## Monthly Maintenance

**HF Data Library API keys expire every 30 days.**

1. Log in to https://hfdatalibrary.com
2. Generate a new API key
3. In Netlify Dashboard → Environment variables → Update `HF_DATA_KEY`
4. Trigger a manual deploy or wait for the next scheduled run

**Tip**: Set a calendar reminder for 28 days after each key generation.

---

## Troubleshooting

### Function times out (120s limit)

The function has a 120s timeout per ticker. If you have many tickers, it may hit the overall limit.

**Fix**: Reduce tickers in `HF_TICKERS`, or increase timeout in `netlify.toml`:

```toml
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = ["package.json", "package-lock.json"]
  # Increase if needed (max 26 minutes on Pro)
  # timeout = 900
```

### "No changes to commit"

This means the data hasn't changed since last run (normal on weekends/holidays).

### Git push fails

Check:
- `GH_TOKEN` has `repo:write` (Contents: Read & Write)
- `GH_REPO` matches exactly (case-sensitive)
- Repo default branch is `main`

### "HF_DATA_KEY invalid / expired"

Regenerate key at hfdatalibrary.com and update Netlify env var.

### Function not triggering

Check:
- `netlify.toml` has `[functions.schedule]` section
- Function appears in Netlify Dashboard → Functions
- Site is on a paid plan (scheduled functions require Pro or above on Netlify)

---

## Local Testing

```bash
# Set env vars locally
export HF_DATA_KEY=your-key
export GH_TOKEN=your-pat
export GH_REPO=sdmtchebe/tickspy

# Run function locally (requires netlify-cli)
netlify functions:invoke update-hfdata
```

Or run the build script directly:

```bash
cd frontend
node scripts/download-hfdata.js
```

---

## Architecture Diagram

```
┌─────────────────────┐     06:00 UTC daily      ┌──────────────────────┐
│  Netlify Scheduler  │ ────────────────────────▶ │  update-hfdata fn    │
└─────────────────────┘                           └──────────┬───────────┘
                                                              │
                    ┌─────────────────────────────────────────┼────────────────────┐
                    ▼                                         ▼                    ▼
            ┌───────────────┐                        ┌─────────────────┐   ┌──────────────┐
            │ HF Data       │                        │ Parse Parquet   │   │ Build JSON   │
            │ Library API   │                        │ → bars + daily  │   │ payload      │
            └───────────────┘                        └─────────────────┘   └──────┬───────┘
                                                                                  │
                                                                                  ▼
                                                                        ┌──────────────────┐
                                                                        │ Git commit +     │
                                                                        │ push to GitHub   │
                                                                        └────────┬─────────┘
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │ Netlify auto-    │
                                                                        │ build + deploy   │
                                                                        └────────┬─────────┘
                                                                                 │
                                                                                 ▼
                                                                        ┌──────────────────┐
                                                                        │ tickspy.com      │
                                                                        │ serves fresh     │
                                                                        │ desk/hfdata/*.json
                                                                        └──────────────────┘
```

---

## Security Notes

- **Never commit API keys** to the repo — use Netlify environment variables only
- The GitHub PAT (`GH_TOKEN`) has write access to your repo — keep it secret
- The function runs in Netlify's isolated environment, not on your machine
- HF Data Library data is CC BY 4.0 — the function includes proper attribution in the JSON payload

---

## Support

If the scheduled function fails:
1. Check Netlify Function logs (Dashboard → Functions → update-hfdata → Logs)
2. Verify env vars are set correctly
3. Test HF Data Library key manually: `curl -H "X-API-Key: YOUR_KEY" https://api.hfdatalibrary.com/v1/bars/SPY`
4. Check GitHub PAT permissions

For questions: tickspysupport@gmail.com