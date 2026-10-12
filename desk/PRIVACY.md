# Privacy Policy

**Last updated:** 2026-10-12

**Public service:** Tickspycorp, Québec, Canada, contact tickspysupport@gmail.com.
The complete, authoritative policy for the hosted website and desk is at
<https://tickspy.com/privacy.html> (French: <https://tickspy.com/privacy-fr.html>).
It covers Netlify/Cloudflare request logs, Google Fonts, jsDelivr, and messages
received through FormSubmit and Gmail, and it sets out the PIPEDA and Québec
Law 25 commitments described below. This file summarises the same position for
the local desk; where the two differ, the public-service policy governs.

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

## What we collect through the contact forms, and why

The only personal information Tickspycorp itself receives is what you choose to
send through the landing page's contact and feedback forms:

- **Contact form:** your **name**, your **email address**, and the **message**.
- **Feedback / bug form:** your **name**, your **email address**, the **category**
  you select, the **message**, and an **optional screenshot** (image, up to 5 MB).
- **Request metadata:** the ordinary information any web request carries, such as
  an IP address, browser details and a timestamp, handled by the delivery and mail
  providers rather than stored by us.

We use it for one purpose only — to **read, answer and resolve your request** and
to investigate anything you report. We do not sell, rent, trade or profile it, and
we do not use it for advertising. Our basis is your **consent**, given by
submitting the form, plus our legitimate interest in answering support requests.
Do not send API keys, passwords, account numbers or sensitive financial details.

## What gets sent, and to whom

The dashboard contacts third parties only when the relevant feature is used, with
one exception: the web fonts load with the page itself.

- **Alpaca** (`data.alpaca.markets`) — market data, news and screener requests,
  authenticated with the key you supply. Used **only if you connect your own
  keys**, which is an optional upgrade: with no keys the desk still works, on the
  replayed sample session described below.
- **The edge API** — a small Cloudflare Worker run by this project. It serves the
  aggregated market headlines, the economic calendar, and the shared AI market
  overview. It is an ordinary public web request: it stores no accounts, keeps no
  per-visitor records beyond response caches, and receives only what any HTTP
  request carries — your IP address and user agent, which Cloudflare handles in
  order to answer it.
- **The bundled sample price file** — the keyless session ships inside the build
  itself, so your browser loads it from the same origin as the page. Those prices
  are generated demonstration data. No visitor request reaches any price provider,
  and using the desk keyless sends nothing anywhere. (If you regenerate the sample
  with the repository's script, it is your build machine that contacts the
  provider; that happens before publishing, not while a visitor browses.)
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
  feedback form on the landing page. It relays the fields above, and any
  screenshot you attach, to the project's support inbox at
  **tickspysupport@gmail.com**, hosted by **Google Gmail**. FormSubmit and Google
  process the message and ordinary request data under their own policies. If you
  never submit that form, neither is contacted.

Each provider has its own privacy policy, and your use of them is governed by
your own agreements with them. We have no control over, and take no
responsibility for, how they handle data.

## Legal framework: PIPEDA and Québec Law 25

Tickspycorp handles personal information in line with Canada's **Personal
Information Protection and Electronic Documents Act (PIPEDA)** and Québec's
**Act respecting the protection of personal information in the private sector, as
modernized by Law 25 (2021, c. 25)**. In practice that means purposes are
identified in plain language before collection; we collect only what a support
reply needs, and only from you; one person is accountable for the information
(see below); we apply proportionate safeguards (HTTPS, provider access controls,
and no database of visitors of our own); and you can exercise the rights below.

## Where your information is handled

Tickspycorp holds support correspondence in Canada, but FormSubmit and Gmail — the
services that deliver it — may process and store it **outside Québec and Canada,
including in the United States**, where the laws and lawful-access rules differ
from Québec's. We rely on providers offering contractual privacy commitments, and
we send only what the message needs.

## Retention

Support messages are kept only as long as needed to answer the request, resolve
the reported issue and meet any applicable legal obligation, then deleted. You
can ask for earlier deletion. Provider logs and the calendar/news sources keep
their own records for their own periods.

## Your rights

Under PIPEDA and Québec Law 25 you may ask Tickspycorp to **access** the personal
information we hold about you and be told how it has been used; **correct** it if
inaccurate, incomplete or ambiguous; **delete** it where the law allows;
**withdraw consent** to optional processing; receive the computerized information
you provided in a **structured, portable** form; and **de-index / cease
dissemination** in defined circumstances. Contact tickspysupport@gmail.com; we may
ask for proportionate identity verification, and we answer within the time the
law requires or explain why we refuse. For information held independently by
providers, contact the relevant provider. Clear browser site data to delete local
preferences.

## Privacy officer and complaints

The person with the highest authority at Tickspycorp is responsible for personal
information protection unless delegated in writing, and is the published privacy
contact: tickspysupport@gmail.com. If unsatisfied, you may complain to the
**Commission d'accès à l'information du Québec** (<https://www.cai.gouv.qc.ca/>)
or, for federal matters, the **Office of the Privacy Commissioner of Canada**
(<https://www.priv.gc.ca/>).

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

You must be 18 or older to use this software. We do not knowingly solicit
children's personal information; if any was submitted, contact us to have it
removed.

## Changes

If this policy changes, the updated version will appear here with a new date, and
the authoritative copy at <https://tickspy.com/privacy.html> will be updated too.
