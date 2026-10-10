# Privacy Policy

**Last updated:** 2026-10-09

This is a summary of what this dashboard does and does not do with your
information. It is written to be read, not to be skimmed past. **This template
is not legal advice** — have it reviewed if you intend to operate the software
as a public service.

---

## The short version

**We collect nothing about you.** There is no account, no sign-up, no analytics,
no advertising, no telemetry, no tracking pixels and no cookies. Nothing you type
here — not your keys, not your watchlist, not your alerts — is stored on our side,
because there is no account for it to attach to.

## What is stored, and where

Everything the dashboard remembers is stored in **your own browser** using
`localStorage`. It never leaves your machine except where you explicitly send it
to a provider you chose.

| Stored locally | What it is |
|---|---|
| `cfg` | Your Alpaca keys, if you enter them. Optional: the desk works without them |
| `wl` | Your watchlist symbols |
| `alerts` | Price alerts you created |
| `calalert` | Your calendar-alert preferences |
| `calfired` | Which scheduled events have already alerted, so none fires twice |
| `calc` | A cached copy of the public economic calendar |
| `legal` | A timestamp recording that you accepted the disclosures |
| `wiz` | Whether you have already seen the optional setup wizard, so it does not reopen |

You can erase all of it at any time by clearing site data for this page in your
browser. Nothing is backed up anywhere else.

## What gets sent, and to whom

The dashboard contacts third parties only when the relevant feature is used, with
one exception: the web fonts load with the page itself.

- **Alpaca** (`data.alpaca.markets`) — market data, news and screener requests,
  authenticated with the key you supply. Used **only if you connect your own
  keys**, which is an optional upgrade: with no keys the desk still works, on a
  replayed previous session from the free source below.
- **The edge API** — a small Cloudflare Worker run by this project. It serves the
  aggregated market headlines, the economic calendar, the keyless end-of-day
  price session and the shared AI market overview. It is an ordinary public web
  request: it stores no accounts, keeps no per-visitor records beyond response
  caches, and receives only what any HTTP request carries — your IP address and
  user agent, which Cloudflare handles in order to answer it.
- **Yahoo Finance** (`query1.finance.yahoo.com`) — the keyless end-of-day price
  series. The edge API asks it for a chart series on your behalf, so the request
  carries the Worker's address and not yours; your browser never contacts Yahoo
  directly. Stooq is kept only as a fallback for the same request.
- **Google Gemini** — used only by the edge API, with the project's own key, to
  write one market overview that is then shared by every visitor. You cannot
  supply a key of your own, and your browser never talks to Gemini.
- **FairEconomy** — the public economic calendar feed, no credentials.
- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) — the page's
  typefaces. Because they load with the page, Google receives your IP address and
  user agent on every visit. No account, no key and nothing you type is involved.
- **The jsDelivr CDN** (`cdn.jsdelivr.net`) — only when you run the volatility
  estimate: the page downloads the TensorFlow.js runtime from this public CDN so
  the model can train in your browser. jsDelivr sees your IP address and user
  agent; nothing else about you is sent.
- **FormSubmit** (`formsubmit.co`) — only if you use the optional contact or
  feedback form on the landing page. It relays what you type, and any screenshot
  you attach, to the project's support inbox. If you never submit that form, it
  is never contacted.

Each provider has its own privacy policy, and your use of them is governed by
your own agreements with them. We have no control over, and take no
responsibility for, how they handle data.

## The bundled local server

`server.py` is **optional**. The dashboard works fully without it: the browser
calls the providers directly and runs its own volatility model, so nothing has to
be running on your machine. If you do run `server.py`, it listens only on
`127.0.0.1` (your own machine), holds no database, writes no log files of your
activity, and forgets everything when you stop it. It exists only to proxy feeds
that a browser cannot call directly, on your own machine.

**Do not expose it to the internet.** It is not designed, hardened or licensed
for public use, and doing so would redistribute third-party market data.

## Eligibility

You must be 18 or older to use this software.

## Your rights

Because no personal data is collected or held by the authors, there is no data
subject access request to make, no data to correct and no data to delete on our
side. For data held by Alpaca, Google or any other provider you use, contact that
provider directly.

## Changes

If this policy changes, the updated version will appear here with a new date.
