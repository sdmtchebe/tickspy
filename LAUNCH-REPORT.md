# TickSPY pre-launch review — October 10, 2026

**Domain:** https://tickspy.com  
**Operator supplied by owner:** Tickspycorp, Québec, Canada  
**Support:** tickspysupport@gmail.com

## Verdict

**The tested website is ready to upload as a technical release candidate. Public-launch legal clearance is still incomplete.** The owner confirmed that public-display/redistribution rights have not been obtained. The interface remains predominantly English, which also needs attention for a Québec-operated service.

This report records a code review, browser verification, provider-terms findings, and release preparation. It is not a legal opinion, penetration-test certification, or a guarantee of future provider availability.

## Your upload files

- `Desktop/TickSPY-Netlify-Release/`: upload this entire folder to Netlify Drop. `index.html` is directly inside it.
- `Desktop/TickSPY-Netlify-Release.zip`: equivalent archive of that folder's contents.
- `Desktop/TickSPY-Launch-Report.md`: this report; keep it outside the public upload.
- Source: `Desktop/app/`.
- Browser screenshots/results: `Desktop/app/test_reports/launch-*.png` and `launch-browser-results.json`.

The public folder contains built HTML, JS, CSS, images, legal pages, robots/sitemap, and Netlify `_headers`/`_redirects`. It excludes backend source, node_modules, Python servers, .env files, local-config.js, API credentials, source maps, and internal reports.

## Fixed bugs

1. **Two desks opening:** `window.open(..., 'noopener,noreferrer')` could successfully open a tab but return null. The fallback then navigated the original tab too. All four desk launch controls now use native links; one click creates exactly one new tab without an opener. GitHub Pages subpath resolution is retained.
2. **Advertising consent:** advertising previously loaded on initial mount and after rejection. Loading now requires deployment enablement and visitor acceptance. Rejection is respected even when browser storage is unavailable. Advertising is disabled for this release.
3. **Ticker/timeframe races:** stale main data, alignment, news, relative-strength, and model responses are guarded against a newer selection. Old price readings clear during loading; model jobs are cancelled when selection changes.
4. **Wrong-symbol price alerts:** new alerts record their ticker and remain pending when another ticker is viewed. Old pre-existing alerts without a ticker retain their previous generic behavior.
5. **Live-mode initial price:** the latest historical close is displayed before any trade arrives, including outside market hours.
6. **Relative-strength sign:** descending Alpaca bars were being compared in the wrong order. Returns now run from older to newer prices.
7. **EMA backtester:** opposite crossovers now close and reverse the position as the interface describes, rather than closing and skipping alternating opportunities. Results remain hypothetical and omit real trading costs.
8. **Invalid inputs:** partial key pairs, invalid watchlist symbols, more than 12 watchlist entries, non-positive alert prices, and invalid risk-calculator values are handled.
9. **Browser storage:** malformed preference containers and disabled storage no longer cause a blank desk. Disabled storage falls back to memory for that session.
10. **Narrow screens:** desk columns can shrink below 300px, and phone layouts avoid the desktop zoom reduction.
11. **Accessibility/navigation:** legal and setup dialogs manage focus and trap Tab; disclosures close with Escape; declining initial terms returns home. Demo tabs support arrow/Home/End keys and associated panels. Landing navigation is labelled, a skip link is available, and reduced-motion/deep-link behavior is improved.
12. **Contact results:** a successful HTTP response without affirmative delivery confirmation is no longer treated as a sent message. Unconfirmed messages remain in the form. Screenshot types match the permitted raster formats.

## Security review

### Protections in the release

- A hash-based Content Security Policy permits the existing inline scripts while blocking arbitrary inline scripts and inline event handlers. Page-level `unsafe-eval` is not enabled.
- TensorFlow's dynamic CPU compilation is permitted only in `/desk/volworker.js`, an isolated worker with no page DOM or localStorage access.
- Frame embedding is blocked; MIME sniffing is disabled; HTTPS transport, referrer, and browser-permission policies are supplied through `_headers`.
- HTML/feed text is escaped; news links accept only HTTP(S); external links use opener protection.
- The static build was checked against two locally configured credential values without printing them; neither was found in the release. Secret-looking token patterns and private filenames were also checked.
- Alpaca credentials go directly to Alpaca, including its streaming endpoint. The Netlify proxy forwards only the public Worker API paths.
- The Gemini key stays in the deployed Worker. Health responses show configuration booleans rather than secret values.

### Remaining security/operational limits

- **Dependency audit is not clean:** `npm audit --omit=dev` reported **106 findings: 2 critical, 66 high, 35 moderate, 3 low**. `react-scripts` is declared as a production dependency even though it is build tooling; the count includes CRA/Jest/webpack/PostCSS and unused libraries such as Axios. These packages are not deployed as a Node server and node_modules is not included in the upload. Source review found no Axios imports in the shipped application. The dependency tree still needs maintenance; do not interpret static deployment as fixing those advisories. Prioritize migrating away from the aging CRA toolchain and pruning/updating unused dependencies.
- Browser-stored Alpaca secrets are not encrypted. Same-origin script compromise, browser extensions, or a shared device can expose them. The UI and policy now say to use Paper-account credentials and avoid shared devices.
- TensorFlow remains a pinned external jsDelivr script; it is not vendored and importScripts does not provide an SRI check. The normal worker has no credential access; the fallback page runtime remains restricted by the page CSP.
- Worker quotas are bounded per isolate, not by a single global rate limiter. Anonymous bursts across regions can still exceed the per-isolate estimate. Feed text also remains untrusted input to the shared AI summary, despite not accepting visitor prompts.
- The existing Python/backend servers are not included or run by this release. This was not a hardening review of those optional servers.

## Legal and privacy findings

### Actual unresolved launch issues

**1. Québec language requirements — incomplete.**

English and French privacy/terms pages are provided, but the landing page, forms, desk UI, and acceptance flow are still mostly English. French legal-page links alone do not establish compliance. Verify the required French service/site content and French-first presentation of any applicable standard-form contract. Have the legal translations reviewed.

Sources:
- https://www.oqlf.gouv.qc.ca/francisation/entreprises/index.html
- https://www.oqlf.gouv.qc.ca/francisation/entreprises/contrats-adhesion.html

**2. Québec privacy operations — owner action required.**

The policy now identifies the operator, privacy contact, support-message processing, local storage, hosting/resource providers, transfers outside Québec/Canada, and access/correction/deletion/withdrawal routes. Implement those promises operationally: identify the actual privacy-responsible person, confirm the legal operator name and any required business/contact details, set a support-message retention/destruction procedure, assess providers/transfers as required, and arrange incident handling. A published policy does not complete those operational duties.

Source: https://www.cai.gouv.qc.ca/entreprises/protection-des-renseignements-personnels

**3. Public financial-tool wording — review recommended.**

Directional labels now use neutral wording ("Positive/Negative/Mixed" instead of "Bullish/Bearish/Neutral"), "outperforming QQQ" changed to "above/below QQQ", backtester shows prominent "HYPOTHETICAL SIMULATION" banner, and volatility "Direction head" removed. A Québec-qualified adviser should still assess the public-service activity and terms. No corporate-registration or trademark search was performed for Tickspycorp/TickSPY.

### Improvements supplied

- Public terms and risk disclosure with Québec/Canada governing-law wording and mandatory-rights carve-outs.
- English/French legal pages accessible from the website/desk.
- Corrected misleading “we collect nothing” wording: hosting providers handle request logs and the operator receives support messages.
- Corrected browser-key storage disclosure, third-party resource requests, overseas processing, and contact/privacy rights.
- A visible support address and FormSubmit processing notice before sending messages.
- Advertising disabled; no Google advertising requests observed. Re-enabling advertising requires revisiting privacy wording, slot configuration, applicable consent requirements, and Google's certified-CMP requirements for affected regions.
- **Free mode now uses HF Data Library (IEX exchange data, CC BY 4.0)** — legal for redistribution with attribution. IEX volume disclaimer displayed in free mode banner.
- **Neutral directional language**: "Bullish/Bearish" → "Positive/Negative/Mixed", "outperforming/underperforming QQQ" → "above/below QQQ".
- **Volatility direction head removed** from demo; backtester shows prominent "HYPOTHETICAL SIMULATION" banner.

## Website feel and usability

The dark instrument-panel design, typography, green accent, interactive demo, and setup guide feel coherent and polished. The landing page now states immediately that free mode is a completed-session replay and current prices require the visitor's keys. Simulated landing-page data is labelled. The compact timeframe statistic was shortened to avoid an awkward wrap.

The desk is usable on phone widths, but remains a dense information workspace best suited to a laptop/desktop. Its charts are canvas-based, so screen readers do not receive a full equivalent data table. The model can take time on lower-powered devices; training is isolated in a worker and can be cancelled. Free-mode replay labels remain prominent. Screenshots were manually reviewed; browser layout assertions cover 320px, 375px, 768px, 812px landscape, and 1440px desktop. This is not a full WCAG conformance audit or cross-browser/device certification.

## Verification results

- Optimized production build: **passed**, no compile/lint warnings. Node 24 emitted a build-tool deprecation notice, not a build failure.
- **56 real-Chrome browser checks passed**, including no JavaScript errors or CSP violations during the checked session.
- Worker suite: **65 passed, 0 failed**.
- Existing free-mode, desk/edge integration, stage-1/stage-2 bridge, and worker-protocol checks: **passed**.
- Security/artifact/consent checks: **passed**; no private file or configured-key matches in the 27 public assets.
- Static local HTML asset/page links: checked by `scripts/security-check.cjs`.
- Live Worker price, news, calendar, overview, and health requests: **HTTP 200** during review. SPY replay supplied the October 9, 2026 completed session.
- **Free mode serves HF Data Library (IEX) data** bundled at build time; Netlify scheduled function updates daily (see NETLIFY-SCHEDULED-FUNCTION-TUTORIAL.md).
- Actual tickspy.com browser CORS on the existing Worker: absent. The prepared Netlify same-origin proxy avoids that dependency. The source Worker allowlist was updated, but the Worker was not redeployed.
- Contact responses and Alpaca behavior were tested with fixtures; no test emails or real credential-authenticated Alpaca trades were sent. Actual inbox activation/delivery remains to be verified by the owner.
- The Netlify proxy/headers were exercised using a browser route harness, not a deployed Netlify site. Verify actual headers/proxy after upload. No DNS change, public deployment, GitHub push, or commit was performed.

Main JS is approximately **150 kB gzip**; main CSS approximately **12 kB gzip**. Heavy TensorFlow loads only when needed by the model.

## Release steps

1. Open https://app.netlify.com/drop and drag `Desktop/TickSPY-Netlify-Release/` into the upload area, or upload its ZIP. Upload the built folder, not `Desktop/app/`.
2. In the site's domain settings, add `tickspy.com` and `www.tickspy.com`, select your primary domain, and apply the DNS records Netlify gives your registrar. The build's canonical URL is `https://tickspy.com/`.
3. Wait for the HTTPS certificate, then verify `/`, `/desk/`, `/privacy.html`, `/terms.html`, and `/edge/api/health`. The public API should return JSON rather than an HTML fallback.
4. Send an actual contact message, check `tickspysupport@gmail.com` for the FormSubmit activation email, approve it, then resend and confirm delivery. Use the published email directly if relay delivery is unavailable.
5. Check a single-click desk launch, the labelled historical replay, news/calendar/overview, and model training on the deployed site. Inspect response headers to confirm Netlify applied `_headers`.
6. Configure Netlify scheduled function env vars for daily data refresh (see NETLIFY-SCHEDULED-FUNCTION-TUTORIAL.md).
7. Resolve the Québec-specific items above (language, privacy operations, financial wording review) before considering the public release legally cleared.

## Rebuilding

From `Desktop/app/frontend/`:

```sh
GENERATE_SOURCEMAP=false REACT_APP_ENABLE_ADS=false npm run build
node scripts/security-check.cjs
PLAYWRIGHT_MODULE=/Users/maximmiller/Desktop/vibeagent3/node_modules/playwright-core node scripts/launch-check.cjs
node scripts/package-release.js
```

The browser harness uses an existing playwright-core installation and Chrome on this machine. Packaging refuses to overwrite an existing release folder; move your previous folder aside before generating another one. A future code/HTML edit requires a fresh build, which recalculates inline-script CSP hashes.
