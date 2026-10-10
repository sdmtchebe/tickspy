# Privacy Policy

**Last updated:** 2026-10-10

**Public service:** Tickspycorp, Québec, Canada, contact tickspysupport@gmail.com.
The complete policy for the hosted website and desk is at
<https://tickspy.com/privacy.html> (French: <https://tickspy.com/privacy-fr.html>).
It covers Netlify/Cloudflare request logs, Google Fonts, jsDelivr, and messages
received through FormSubmit and Gmail. The description below concerns local
desk preferences; it does not override the public-service policy.

This is a summary of what this dashboard does and does not do with your
information. It is written to be read, not to be skimmed past. **This template
is not legal advice** — have it reviewed if you intend to operate the software
as a public service.

---

## The short version

The desk has no account, sign-up, analytics, or advertising. Keys, watchlists and
alerts remain in your browser. Hosting providers process ordinary request data,
and support correspondence is received by the operator. Advertising is disabled
on the launch version of the landing page.

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
  aggregated market headlines, the economic calendar, and the shared AI market
  overview. It is an ordinary public web request: it stores no accounts, keeps no
  per-visitor records beyond response caches, and receives only what any HTTP
  request carries — your IP address and user agent, which Cloudflare handles in
  order to answer it.
- **HF Data Library** (`api.hfdatalibrary.com`) — the previous completed session
  of IEX exchange data (CC BY 4.0). The build process fetches this data at
  compile time and bundles it with the desk; the browser loads it from the same
  origin. No visitor request reaches HF Data Library directly.
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

For access, correction, deletion where applicable, withdrawal of optional consent,
or privacy complaints concerning support correspondence held by Tickspycorp,
contact tickspysupport@gmail.com. For information held independently by providers,
contact the relevant provider. Clear browser site data to delete local preferences.

## Changes

If this policy changes, the updated version will appear here with a new date.
