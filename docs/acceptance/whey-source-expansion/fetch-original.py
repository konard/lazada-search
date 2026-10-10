#!/usr/bin/env python3
"""Retain public manufacturer response bytes; reuse receipts and pace each host."""
import gzip
import hashlib
import json
import pathlib
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
ALLOWED = {
    "levelsprotein.com", "www.levelsprotein.com", "www.ruleoneproteins.com",
    "ruleoneproteins.com", "138foods.com", "www.138foods.com",
    "nutrabolics.com", "teamwarrior.com", "mutantnation.com",
    "bioxnutrition.com", "musaking.com", "cleansimpleeats.com",
    "scitecnutrition.com", "appliednutrition.uk", "prosupps.com", "musclenation.org",
    "www.prosupps.com", "cdn.shopify.com",
}


def fetch(name, url):
    if not name.replace("-", "").isalnum():
        raise ValueError("Artifact name must contain only letters, digits and hyphens")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED or parsed.username:
        raise ValueError("Only allowlisted public manufacturer HTTPS URLs are accepted")
    receipt_path = ROOT / f"{name}.source.json"
    if receipt_path.exists():
        print(json.dumps({"name": name, "cacheHit": True, "receipt": str(receipt_path)}), flush=True)
        return
    host = parsed.hostname.removeprefix("www.")
    host_path = ROOT / f"host-{host}.pace.json"
    previous = json.loads(host_path.read_text()) if host_path.exists() else {}
    remaining = 61 - (time.time() - previous.get("requestStartedEpoch", 0))
    if remaining > 0:
        print(json.dumps({"name": name, "host": host, "waitingSeconds": round(remaining, 2)}), flush=True)
        time.sleep(remaining)
    started = datetime.now(timezone.utc).isoformat()
    host_path.write_text(json.dumps({"requestStartedEpoch": time.time(), "url": url, "observedAt": started}, indent=2) + "\n")
    request = urllib.request.Request(url, headers={"User-Agent": "lazada-search/0.1 (public manufacturer evidence audit)", "Accept-Encoding": "identity"})
    try:
        response = urllib.request.urlopen(request, timeout=35, context=ssl.create_default_context(cafile="/etc/ssl/cert.pem"))
    except urllib.error.HTTPError as error:
        response = error
    except urllib.error.URLError as error:
        receipt = {"name": name, "url": url, "observedAt": started, "successful": False,
                   "error": str(error.reason), "responseBodyReceived": False,
                   "minimumSameHostIntervalSeconds": 61}
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)
        return
    with response:
        body = response.read()
        final_url = response.geturl()
        status = response.status
        content_type = response.headers.get("Content-Type", "")
        headers = dict(response.headers)
    final_host = urllib.parse.urlsplit(final_url).hostname
    extension = ".html" if "html" in content_type else ".json" if "json" in content_type else ".png" if "png" in content_type else ".webp" if "webp" in content_type else ".jpg" if "jpeg" in content_type else ".response"
    filename = f"{name}{extension}"
    if extension in {".html", ".json"}:
        filename += ".gz"
        (ROOT / filename).write_bytes(gzip.compress(body, mtime=0))
        encoding = "gzip; hash and bytes refer to decompressed original response body"
    else:
        (ROOT / filename).write_bytes(body)
        encoding = "original response body"
    receipt = {"name": name, "url": url, "finalUrl": final_url, "status": status,
               "successful": 200 <= status < 300 and final_host in ALLOWED,
               "sourceAuthority": "manufacturer" if final_host in ALLOWED else "redirect outside manufacturer allowlist",
               "observedAt": started, "contentType": content_type, "headers": headers,
               "artifact": filename, "encoding": encoding, "sha256": hashlib.sha256(body).hexdigest(),
               "bytes": len(body), "cacheHit": False, "minimumSameHostIntervalSeconds": 61,
               "method": "Single public GET; original response body retained; HTTP errors cached without retry; no browser or Lazada traffic; no shared associative store write."}
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: receipt[k] for k in ["name", "url", "status", "successful", "observedAt", "artifact", "sha256", "bytes"]}), flush=True)


if __name__ == "__main__":
    fetch(sys.argv[1], sys.argv[2])
