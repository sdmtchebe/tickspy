# Disclaimers, Terms of Use and Risk Disclosure

**Last updated:** 2026-10-10

Public-service operator: **Tickspycorp, Québec, Canada**.
Contact: tickspysupport@gmail.com. Service terms and privacy notices are at
<https://tickspy.com/terms.html> and <https://tickspy.com/privacy.html>.

> **This file is a good-faith template, not legal advice, and no disclaimer can
> make an unlawful activity lawful.** Before you publish, host or distribute this
> software or anything built from it, have a qualified attorney review it in your
> jurisdiction. Two issues in particular cannot be fixed with wording alone — see
> **"Market data and redistribution"** below.

---

## 1. Not investment advice

This project ("the Software") is an **educational and research tool**. Nothing
produced by it — indicators, scores, bullish and bearish readings, volatility forecasts,
regime labels, backtests, AI-generated text or any other output — is investment,
financial, legal, accounting or tax advice.

Nothing here is a **recommendation, solicitation, offer or invitation** to buy,
sell, hold or transact in any security, nor a statement that any security is
suitable for any person. All output is **impersonal commentary of general
circulation**, prepared without knowledge of any individual's objectives,
financial situation, risk tolerance or needs. It is not tailored to you, and it
must not be relied upon as if it were.

## 2. No advisory, broker-dealer or fiduciary relationship

No investment adviser, broker-dealer, financial planner or fiduciary
relationship is created by your use of the Software, and none is intended. The
authors are **not** registered investment advisers or broker-dealers with the
U.S. Securities and Exchange Commission, any state regulator, the Financial
Industry Regulatory Authority, or any equivalent authority anywhere. The authors
do not provide personalized investment recommendations through the Software.

## 3. Risk of loss

Trading and investing involve **substantial risk of loss, up to and including
the total loss of your capital**. Leverage, margin, short selling and options can
lose more than you deposit. You alone are responsible for your own investment
decisions and their consequences. **Do not make a trading decision based on this
Software.** Consult a licensed, qualified professional who knows your personal
circumstances.

## 4. Estimates, not predictions

Every figure produced by the Software is a **statistical estimate derived from
historical prices**, not a prediction or a fact about the future. Models can be
wrong, mis-specified, overfit, or silently degraded by changing market
conditions, data errors or outages. Confidence figures and reliability labels
describe past out-of-sample behaviour only and may not persist.

The volatility model in particular reports an explicitly measured reliability
and frequently has **little or no demonstrable skill**, especially in its
directional component. Where the Software states that a component is not
reliable, that statement is genuine and should be believed.

## 5. Hypothetical and simulated performance

Backtest and walk-forward results are **hypothetical and simulated**. They are
prepared with the benefit of hindsight, do not represent actual trading, and do
not reflect the impact of commissions, fees, spreads, slippage, market impact,
liquidity, taxes, margin interest, borrow costs or the psychological pressures of
real trading. Results cover limited samples and specific market regimes.

**Hypothetical performance has many inherent limitations and no representation
is made that any account would or could achieve results similar to those shown.
Past performance, whether actual or simulated, is not indicative of future
results.**

## 6. Market data and redistribution — read this before publishing

Market data displayed by the Software is obtained from third-party providers.
With your own credentials that is **Alpaca** and, through it, exchange feeds such
as **IEX**. With no credentials the Software loads the previous completed session
from **HF Data Library (IEX exchange data, CC BY 4.0)** — one shared, cached copy
per symbol, delayed, end-of-day, one session old, and replayed rather than
streamed. Either way the data is licensed, not owned by you, and is subject to the
provider's terms.

- Alpaca's published position is that **you may not redistribute its API data**.
- Exchange market data generally requires a **display or distribution agreement**
  for any customer-facing or public use.
- Free or personal tiers are typically licensed for **personal, non-commercial
  use only**.
- **HF Data Library (IEX) data is CC BY 4.0 redistributable with attribution.**
  IEX represents ~2–3% of consolidated volume and is not the NBBO.
- **The no-credentials view is one completed session old, end-of-day, and
  replayed** rather than streamed. It is not a live quote, it must never be
  presented or relied on as one, and it is labelled as such on screen.

Consequently: **do not publish, host, sublicense, resell or otherwise expose this
Software — or a service built on it — in a way that serves or redistributes
market data to anyone but you.** Doing so may breach your data agreements and
expose you to claims from the data providers, irrespective of any disclaimer
here. If you want a public product, obtain the appropriate written licences and
agreements from every provider first. The bundled server refuses to bind to a
non-local address unless explicitly overridden, and that override does not grant
you any right you do not otherwise have.

All product names, logos and trademarks are the property of their respective
owners and are used for identification only. No endorsement, sponsorship or
affiliation is implied.

## 7. Third-party and AI services

The Software uses third-party services. Some you connect yourself — **Alpaca**,
if you choose to enter your own free keys for live market data — and some the
project operates on your behalf: **HF Data Library (IEX exchange data, CC BY 4.0)**
(the keyless previous-session price source, bundled at build time), the public
news feeds and the FairEconomy economic calendar it aggregates, **Cloudflare**,
which hosts the edge function, and **Google Gemini**, which writes the single
shared market overview. The page also loads its web fonts from **Google Fonts**,
fetches the TensorFlow.js runtime from the **jsDelivr** CDN when the volatility
estimate runs, and posts the optional contact and feedback forms through
**FormSubmit**. Your use of the services you connect is governed entirely by
your own agreements with them, and you are responsible for complying with those
terms, including any usage limits and costs.

**No AI key is ever supplied by a visitor, and the Software asks for none.** The
overview is written on a schedule with the project's own key, cached, and read by
every visitor from that cache, so the number of AI calls follows the clock rather
than the audience. There is no path by which a visitor can spend that key.

Generative AI output is **machine-generated text**. It may be inaccurate,
incomplete, out of date, biased or entirely fabricated ("hallucinated"). It has
not been verified. Treat it as a draft to check, never as a statement of fact and
never as a recommendation.

## 8. No warranty

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE, TITLE, ACCURACY AND NON-INFRINGEMENT.** No warranty is
given that the Software will be uninterrupted, timely, secure, error-free, or
that any data, calculation or output will be accurate or complete.

## 9. Limitation of liability

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE AUTHORS AND
CONTRIBUTORS OF THE SOFTWARE SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE OR CONSEQUENTIAL DAMAGES, OR FOR ANY
LOSS OF PROFITS, CAPITAL, DATA, GOODWILL OR BUSINESS OPPORTUNITY, ARISING FROM OR
RELATED TO THE USE OF, OR INABILITY TO USE, THE SOFTWARE — WHETHER BASED IN
CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY OR OTHERWISE, AND EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.**

Where liability cannot be excluded, it is limited to the greater of the amount
you paid for the Software (usually zero) or the minimum permitted by law.

## 10. Your responsibility and indemnity

You are solely responsible for how you use the Software, for complying with all
laws and regulations applicable to you, and for complying with the terms of any
third-party service you connect. You agree to indemnify and hold harmless the
authors and contributors against any claim, loss, liability or expense (including
reasonable legal fees) arising from your use of the Software, your breach of
these terms, or your infringement of any third party's rights.

## 11. Eligibility

The Software is not intended for, and must not be used by, any person in a
jurisdiction where its distribution or use would be contrary to local law or
regulation, or where it would subject the authors to any registration or
licensing requirement.

## 12. Privacy

The Software has no accounts, no analytics, no telemetry, no advertising and no
tracking cookies. Any API keys you enter are stored **only in your own browser
(local storage)** and are transmitted only to the providers you choose — the
project never receives them. The small edge function keeps no accounts and no
per-visitor records beyond its response caches; it sees only what any ordinary
web request carries (an IP address and user agent, handled by Cloudflare). If you
run the bundled local server, it runs on your machine and forwards requests on
your behalf; it does not retain your keys. The `local-config.js` file, if
present, contains keys in plain text and is excluded from version control — keep
it that way.

## 13. No legal advice

This document is provided for information only and does **not** constitute legal
advice. Requirements vary by jurisdiction and change over time. Obtain
professional legal advice before relying on it.

---

*If any provision of these terms is held unenforceable, the remaining provisions
remain in full force and effect.*
