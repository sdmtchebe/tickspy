# Privacy Policy

**Last updated:** 2026-10-03

This is a summary of what this dashboard does and does not do with your
information. It is written to be read, not to be skimmed past. **This template
is not legal advice** — have it reviewed if you intend to operate the software
as a public service.

---

## The short version

**We collect nothing.** There is no account, no sign-up, no server operated by
the authors, no analytics, no advertising, no telemetry, no tracking pixels and
no cookies. Nothing about you is transmitted to us, because there is nowhere for
it to be transmitted to.

## What is stored, and where

Everything the dashboard remembers is stored in **your own browser** using
`localStorage`. It never leaves your machine except where you explicitly send it
to a provider you chose.

| Stored locally | What it is |
|---|---|
| `cfg` | Your API keys and provider settings |
| `wl` | Your watchlist symbols |
| `alerts` | Alerts you created |
| `journal` | Trades you logged |
| `legal` | A timestamp recording that you accepted the disclosures |
| `g...` | A daily counter of summary requests made, to respect usage caps |

You can erase all of it at any time by clearing site data for this page in your
browser. Nothing is backed up anywhere else.

## What gets sent, and to whom

The dashboard contacts third parties **only when you configure it to and use the
relevant feature**:

- **Alpaca** (`data.alpaca.markets`) — market data, news and screener requests,
  authenticated with the key you supply. Required for the dashboard to load data.
- **Google Gemini** (`generativelanguage.googleapis.com`) — only for the optional
  factual news and calendar summaries, authenticated with the key you supply and
  sent only the public headline or event text being summarised.
- **A local model server** (e.g. `127.0.0.1:11434`) — only if you select the local
  provider. It runs on your own machine.
- **FairEconomy calendar feed** — the public economic calendar, no credentials.

Each of those providers has its own privacy policy, and your use of them is
governed by your own agreements with them. We have no control over, and take no
responsibility for, how they handle data.

## The bundled local server

If you run `server.py`, it listens only on `127.0.0.1` (your own machine), holds
no database, writes no log files of your activity, and forgets everything when
you stop it. It exists solely to forward requests from your browser to the
providers, because browsers cannot call those APIs directly.

**Do not expose it to the internet.** It is not designed, hardened or licensed
for public use, and doing so would redistribute third-party market data.

## Children

This software is not intended for anyone under 18.

## Your rights

Because no personal data is collected or held by the authors, there is no data
subject access request to make, no data to correct and no data to delete on our
side. For data held by Alpaca, Google or any other provider you use, contact that
provider directly.

## Changes

If this policy changes, the updated version will appear here with a new date.
