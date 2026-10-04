import http.server, urllib.request, urllib.parse, urllib.error, os, ssl, json, re, sys

QUIET = "-q" in sys.argv or "--quiet" in sys.argv


def _compact(msg):
    # Proxy URLs are long and repeat constantly; log the host and path only.
    def f(m):
        u = urllib.parse.unquote(m.group(2))
        p = urllib.parse.urlparse(u)
        return "%s /p -> %s%s" % (m.group(1), p.hostname or "?", p.path or "")
    return re.sub(r"(GET|POST) /p\?u=(\S+)", f, msg)

OK = ("data.alpaca.markets", "nfs.faireconomy.media")
LOCAL = ("127.0.0.1", "localhost", "::1")

def _ctx():
    # Prefer certifi, then common macOS/Linux CA bundles. python.org builds of
    # Python ship no CA store, which is why urllib fails with CERTIFICATE_VERIFY_FAILED.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    ctx = ssl.create_default_context()
    for p in ("/etc/ssl/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem",
              "/usr/local/etc/openssl/cert.pem", "/etc/pki/tls/certs/ca-bundle.crt"):
        try:
            ctx.load_verify_locations(p)
            return ctx
        except Exception:
            continue
    return ctx

CTX = _ctx()

def _unverified():
    c = ssl.create_default_context()
    c.check_hostname = False
    c.verify_mode = ssl.CERT_NONE
    return c

def _open(u, hd, data=None, timeout=15):
    def go(ctx):
        return urllib.request.urlopen(urllib.request.Request(u, data=data, headers=hd), timeout=timeout, context=ctx)
    try:
        return go(CTX)
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            print("Warning: TLS verification failed, retrying unverified.")
            print("Fix permanently: /Applications/Python 3.14/Install Certificates.command")
            return go(_unverified())
        raise

class H(http.server.SimpleHTTPRequestHandler):
    def _cors(s):
        # The desk page is also bundled into the marketing site, whose origin is
        # different from this server, so the local API endpoints must be callable
        # cross-origin. Only the /p, /vol and /lm handlers apply this.
        s.send_header("Access-Control-Allow-Origin", "*")
        s.send_header("Access-Control-Allow-Headers", "*")
        s.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(s):
        s.send_response(204)
        s._cors()
        s.send_header("Content-Length", "0")
        s.end_headers()

    def log_message(s, fmt, *a):
        msg = fmt % a
        # Browser extensions and favicon probes hit the local server noisily; skip them.
        # The 404 for a missing favicon logs as a pathless "code 404" line, so filter that too.
        if "hybridaction" in msg or "favicon" in msg:
            return
        if "code 404" in msg and "File not found" in msg:
            return
        if QUIET:
            return
        super().log_message("%s", _compact(msg))

    def do_GET(s):
        if s.path.startswith("/p?"):
            u = urllib.parse.parse_qs(urllib.parse.urlparse(s.path).query).get("u", [""])[0]
            host = urllib.parse.urlparse(u).hostname
            if host not in OK and host not in LOCAL:
                s.send_error(403); return
            hd = {k: v for k, v in s.headers.items() if k.upper().startswith("APCA-")}
            hd["User-Agent"] = "Mozilla/5.0"
            try:
                r = _open(u, hd)
                code, body = r.status, r.read()
            except urllib.error.HTTPError as e:
                code, body = e.code, e.read()
            except Exception as e:
                code, body = 502, str(e).encode()
            s.send_response(code); s.send_header("Content-Type", "application/json"); s._cors(); s.end_headers(); s.wfile.write(body)
        else:
            if s.path == "/": s.path = "/index.html"
            super().do_GET()

    def do_POST(s):
        if s.path.startswith("/vol"):
            # Two-stage volatility forecast. Heavy deps (pandas/torch) and the
            # model graph are imported lazily so the server still starts fast.
            n = int(s.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(s.rfile.read(n) or b"{}")
            except Exception:
                payload = {}
            try:
                bars = payload.get("bars") or []
                if len(bars) < 120:
                    raise ValueError("Need at least 120 bars for the volatility model.")
                import pandas as pd
                from volatility_predictor import predict_cached
                df = pd.DataFrame(bars)
                if "t" in df.columns:
                    df = df.rename(columns={"t": "timestamp"})
                ppy = payload.get("periods_per_year")
                out = json.dumps(predict_cached(
                    df,
                    symbol=payload.get("symbol") or "SPY",
                    timeframe=payload.get("timeframe") or "1Min",
                    periods_per_year=(float(ppy) if ppy else None),
                    strict=bool(payload.get("strict")),
                    force=bool(payload.get("force")),
                )).encode()
            except Exception as e:
                out = json.dumps({"error": str(e)}).encode()
            s.send_response(200); s.send_header("Content-Type", "application/json")
            s.send_header("Cache-Control", "no-store"); s._cors(); s.end_headers(); s.wfile.write(out)
            return
        # Chat with a local OpenAI-compatible model server (Ollama, LM Studio, llama.cpp).
        if s.path.startswith("/lm"):
            n = int(s.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(s.rfile.read(n) or b"{}")
            except Exception:
                payload = {}
            base = str(payload.get("base") or "http://127.0.0.1:11434").rstrip("/")
            if urllib.parse.urlparse(base).hostname not in LOCAL:
                s.send_error(403); return
            body = json.dumps({"model": payload.get("model") or "", "messages": payload.get("messages") or [], "stream": False}).encode()
            hd = {"Content-Type": "application/json", "Authorization": "Bearer local"}
            try:
                r = _open(base + "/v1/chat/completions", hd, data=body, timeout=300)
                code, out = r.status, r.read()
            except urllib.error.HTTPError as e:
                code, out = e.code, e.read()
            except Exception as e:
                code, out = 502, json.dumps({"error": str(e)}).encode()
            s.send_response(code); s.send_header("Content-Type", "application/json"); s._cors(); s.end_headers(); s.wfile.write(out)
        else:
            s.send_error(404)

NOTICE = (
    "\n"
    "  PERSONAL, NON-COMMERCIAL USE ONLY.\n"
    "  Market data is supplied by Alpaca / IEX and must not be redistributed or\n"
    "  served to the public. This dashboard is NOT investment advice, is not a\n"
    "  recommendation to buy or sell any security, and comes with no warranty.\n"
    "  See DISCLAIMER.md. Trading involves risk of loss.\n"
)


def _host():
    """Bind to localhost by default and make public exposure a deliberate act."""
    host = os.environ.get("HOST") or "127.0.0.1"
    if host not in LOCAL:
        if os.environ.get("ALLOW_PUBLIC") != "1":
            print("\nRefusing to bind to %r." % host)
            print(NOTICE)
            print("  Exposing this dashboard would serve third-party market data to the\n"
                  "  public, breaching Alpaca/IEX terms and creating legal exposure.\n"
                  "  If you genuinely intend to, set ALLOW_PUBLIC=1 and get written\n"
                  "  permission from your data providers first.\n")
            raise SystemExit(2)
        print("\n*** WARNING: bound to %s, reachable by other machines. ***" % host)
        print(NOTICE)
    return host


os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT") or 8000)  # PORT=8123 lets you run a second copy
HOST = _host()
print(NOTICE)
print("Open http://localhost:%d  (Ctrl+C to stop)" % PORT)
http.server.ThreadingHTTPServer((HOST, PORT), H).serve_forever()
