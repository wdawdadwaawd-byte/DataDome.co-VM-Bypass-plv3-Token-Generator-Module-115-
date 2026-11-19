#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Etsy & DataDome Client
======================
Session client that bypasses DataDome protection on Etsy,
impersonates Chrome TLS fingerprint, and handles session/cookie management automatically.
"""

import base64
import hashlib
import json
import os
import random
import re
import time
import urllib.parse
from curl_cffi import requests

from .vm_bridge import get_vm_token

DDK = "D013AA612AB2224D03B2318D0F5B19"
DDV = "5.11.5"
IMPERSONATE = "chrome136"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
HOME_URL = "https://www.etsy.com/?utm_source=chatgpt.com"
JSPL_URL = "https://www.etsy.com/include/tags.js"
API_URL = "https://www.etsy.com/api/v3/ajax/bespoke/member/neu/specs/Join_Neu_Controller?submit_attempt=enter_password"
_UAID_MAGIC = bytes([0x63, 0x64, 0x00, 0x82, 0xAC, 0x3F])


def generate_uaid() -> str:
    """Generates a random 71-byte Etsy-compatible uaid."""
    head = os.urandom(20)
    tail = os.urandom(44)
    null = b"\x00"
    raw = head + _UAID_MAGIC + tail + null
    return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "."


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode().rstrip("=").replace("+", "-").replace("/", "_")


def build_jspl_body(cid: str, vm_token: dict | None = None) -> str:
    """Builds the device and browser telemetry payload (jspl) for DataDome tags.js."""
    rng = random.Random(cid[:16] if cid else "seed")
    now = int(time.time() * 1000)
    ns = now - rng.randint(2500, 7000)
    dr = ns + rng.randint(500, 1400)
    le = now - rng.randint(50, 400)
    mm = rng.randint(400, 650)
    kd = rng.randint(3, 8)
    cl = rng.randint(5, 9)

    events = {
        "mousemove": mm, "pointermove": mm, "click": cl, "scroll": 0,
        "touchstart": 0, "touchend": 0, "touchcancel": 0, "touchmove": 0,
        "keydown": kd, "keyup": kd, "paste": 1,
        "input": rng.randint(1, 3), "change": 1,
    }
    scr = rng.choice([
        {"sw": 1920, "sh": 1080, "ow": 1920, "oh": 1040, "iw": 1904, "ih": 969},
        {"sw": 1366, "sh": 768, "ow": 1366, "oh": 728, "iw": 1350, "ih": 657},
    ])
    wgl = rng.choice([
        ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ])
    perf = {
        "navigationStart": ns, "fetchStart": ns + 2, "domainLookupStart": ns + 5,
        "domainLookupEnd": ns + 20, "connectStart": ns + 25, "connectEnd": ns + 80,
        "requestStart": ns + 120, "responseStart": ns + 300, "responseEnd": ns + 500,
        "domLoading": ns + 510, "domInteractive": dr - 200,
        "domContentLoadedEventStart": dr - 50, "domContentLoadedEventEnd": dr,
        "domComplete": le - 200, "loadEventStart": le - 50, "loadEventEnd": le,
    }
    fp = {
        "ddk": DDK, "ddv": DDV, "jsType": "le", "cid": cid,
        "ts": now, "ns": ns, "dr": dr, "le": le,
        "ua": UA, "pf": "Win32", "vd": "Google Inc.",
        "lg": "tr-TR", "lgs": ["tr-TR", "tr", "en-US", "en"],
        "hc": 8, "mtp": 0, "dm": 8, "ce": True, "dnt": None,
        "pdfv": True, "java": False,
        **scr, "cd": 24, "pd": 24, "dpr": 1.0, "sx": 0, "sy": 0,
        "saw": scr["sw"], "sah": scr["sh"] - 40,
        "wv": wgl[0], "wr": wgl[1],
        "cvh": "2q," + hashlib.md5(cid.encode()).hexdigest(),
        "afp": round(124.0 + rng.uniform(-0.3, 0.3), 13),
        "tz": "Europe/Istanbul", "tzo": -180,
        "ec": events, "pt": perf,
        "fn": ["Arial", "Calibri", "Courier New", "Georgia", "Helvetica", "Impact",
               "Segoe UI", "Tahoma", "Times New Roman", "Verdana"],
        "pl": ["PDF Viewer", "Chrome PDF Viewer", "Chromium PDF Viewer"],
        "vc": 'video/mp4; codecs="avc1.42E01E"', "ac": "audio/mpeg;",
        "wa": True, "idb": True, "ls": True, "ss": True,
        "wd": False, "phantom": False, "nightmare": False,
        "dl": 10, "rtt": 100, "ect": "4g",
        "cw": scr["iw"], "ch": scr["ih"],
        "oiw": scr["ow"], "oih": scr["oh"],
    }
    if vm_token:
        if vm_token.get("r"):
            fp["plv3"] = vm_token["r"]
        if vm_token.get("i"):
            fp["tagx"] = vm_token["i"]
        if vm_token.get("u"):
            fp["tagu"] = vm_token["u"]

    jspl = _b64(json.dumps(fp, separators=(",", ":")).encode())
    evt_json = json.dumps(events, separators=(",", ":"))
    ref_enc = urllib.parse.quote(HOME_URL, safe="")
    path_enc = urllib.parse.quote("/?utm_source=chatgpt.com", safe="")

    params = [
        ("jspl", jspl),
        ("eventCounters", evt_json),
        ("jsType", "le"),
        ("cid", cid),
        ("ddk", DDK),
        ("Referer", ref_enc),
        ("request", path_enc),
        ("responsePage", "origin"),
        ("ddv", DDV),
    ]
    return urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


class EtsyClient:
    """Session and navigation client that bypasses DataDome on Etsy."""

    def __init__(self, impersonate: str = IMPERSONATE):
        self.session = requests.Session(impersonate=impersonate)
        self.uaid = ""
        self.datadome = ""
        self.csrf_nonce = ""
        self.is_initialized = False

    def init_session(self) -> bool:
        """
        Step 1: Connects to the homepage and retrieves uaid,
        initial datadome cookie, and csrf_nonce.
        """
        r = self.session.get(HOME_URL, allow_redirects=True, timeout=20)
        self.uaid = self.session.cookies.get("uaid", "")
        self.datadome = self.session.cookies.get("datadome", "")

        for sc in r.headers.get("Set-Cookie", "").split(","):
            sc = sc.strip()
            if sc.startswith("uaid=") and not self.uaid:
                self.uaid = sc.split(";")[0][len("uaid="):]
            if sc.startswith("datadome=") and not self.datadome:
                self.datadome = sc.split(";")[0][len("datadome="):]

        m = re.search(r'name="csrf_nonce"\s+content="([^"]+)"', r.text)
        self.csrf_nonce = m.group(1) if m else ""

        if not self.uaid:
            self.uaid = generate_uaid()
            self.session.cookies.set("uaid", self.uaid, domain=".etsy.com")

        self.is_initialized = (r.status_code == 200)
        return self.is_initialized

    def activate_datadome(self, rounds: int = 1) -> str:
        """
        Step 2: Generates a DataDome VM (Module 115) token and sends telemetry
        to /include/tags.js, then updates the session cookie with the validated token.
        """
        for _ in range(rounds):
            cid = self.datadome or self.session.cookies.get("datadome", "")
            vm_tok = None
            try:
                vm_tok = get_vm_token("yes")
            except Exception as e:
                print(f"[EtsyClient] VM token warning: {e}")

            body = build_jspl_body(cid, vm_token=vm_tok)
            r = self.session.post(
                JSPL_URL,
                data=body,
                headers={
                    "accept": "*/*",
                    "content-type": "application/x-www-form-urlencoded",
                    "origin": "https://www.etsy.com",
                    "referer": HOME_URL,
                },
                allow_redirects=False,
                timeout=20,
            )

            token = ""
            try:
                rj = r.json()
                c = rj.get("cookie", "")
                if "datadome=" in c:
                    for p in c.split(";"):
                        p = p.strip()
                        if p.startswith("datadome="):
                            token = p[len("datadome="):]
                            break
            except Exception:
                pass

            if not token:
                for p in r.headers.get("Set-Cookie", "").split(";"):
                    p = p.strip()
                    if p.startswith("datadome="):
                        token = p[len("datadome="):]
                        break
            if not token and "datadome" in self.session.cookies:
                token = self.session.cookies["datadome"]

            if token:
                self.datadome = token
                self.session.cookies.set("datadome", token, domain=".etsy.com")

        return self.datadome

    def get(self, url: str, **kwargs):
        """Fetches a protected Etsy page using the active session cookies."""
        return self.session.get(url, **kwargs)

    def login(self, email: str, password: str, page_guid: str = "") -> dict:
        """
        Step 3: Sends a login request via the Join_Neu_Controller endpoint.
        """
        if not page_guid:
            rand1 = "".join(random.choices("0123456789abcdef", k=12))
            rand2 = "".join(random.choices("0123456789abcdef", k=16))
            page_guid = f"{rand1}.{rand2}.00"

        payload = json.dumps({
            "log_performance_metrics": False,
            "specs": {
                "Join_Neu_Controller": ["Join_Neu_ApiSpec_Page", {
                    "state": {
                        "with_action_context": False,
                        "initial_state": "sign-in",
                        "persistent": "true",
                        "from_page": HOME_URL,
                        "from_action": "signin-header",
                        "form_action": "",
                        "workflow": {"identifier": "", "type": ""},
                        "view_type": "overlay",
                        "password": password,
                        "show_social_sign_in": False,
                        "login_only": False,
                        "is_from_etsyapp": False,
                        "submit_attempt": "enter_password",
                        "should_use_new_password_skin": False,
                        "should_show_order_tracking": False,
                        "workflow_identifier": "",
                        "workflow_type": "",
                        "third_party_authenticator": "",
                        "boe_page_source": "",
                        "_nnc": self.csrf_nonce,
                        "email": email,
                    }
                }]
            },
            "runtime_analysis": False,
            "is_buildavite_enabled": True,
        }, separators=(",", ":"))

        headers = {
            "accept": "*/*",
            "content-type": "application/json",
            "origin": "https://www.etsy.com",
            "referer": HOME_URL,
            "x-detected-locale": "TRY|en-US|TR",
            "x-etsy-protection": "1",
            "x-page-guid": page_guid,
            "x-recs-is-elp": "false",
            "x-recs-primary-location": HOME_URL,
            "x-recs-primary-referrer": "",
        }
        if self.csrf_nonce:
            headers["x-csrf-token"] = self.csrf_nonce

        r = self.session.post(API_URL, data=payload, headers=headers, allow_redirects=False, timeout=20)
        return {
            "status": r.status_code,
            "ok": r.status_code == 200,
            "body": r.text,
            "datadome": self.datadome,
            "uaid": self.uaid,
        }
