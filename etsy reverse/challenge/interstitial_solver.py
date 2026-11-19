#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DataDome Interstitial Challenge Solver
======================================
When an 'rt: i' (interstitial challenge) is received from Etsy or any
DataDome-protected site, this module opens the challenge page and runs
Module 115 and telemetry in a Node.js virtual browser environment
(run_interstitial.js) to obtain the validation token.
"""

import os
import re
import sys
import json
import subprocess
import urllib.parse
from curl_cffi import requests as cf

HOME_URL = "https://www.etsy.com/?utm_source=chatgpt.com"
IMPERSONATE = "chrome136"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"

_DIR = os.path.dirname(os.path.abspath(__file__))
_RUNNER = os.path.join(_DIR, "run_interstitial.js")


def _gf(raw: str, key: str) -> str:
    p = re.search(r"'" + key + r"'\s*:\s*'([^']*)'", raw)
    if p: return p.group(1)
    p = re.search(r'"' + key + r'"\s*:\s*"([^"]*)"', raw)
    if p: return p.group(1)
    p = re.search(r"'" + key + r"'\s*:\s*([0-9]+)", raw)
    if p: return p.group(1)
    return ""


def _parse_ddm(html: str) -> dict:
    start = html.find("var ddm = {")
    if start < 0: start = html.find("var ddm={")
    if start < 0: return {}
    end = html.find("};", start) + 2
    sec = html[start:end]
    result = {}
    for m in re.finditer(r"(\w+)\s*:\s*'([^']*)'", sec):
        result[m.group(1)] = m.group(2).strip()
    for m in re.finditer(r"(\w+)\s*:\s*([0-9]+)\s*[,}]", sec):
        if m.group(1) not in result:
            result[m.group(1)] = m.group(2)
    for field in ["referer", "url", "captchaUrl"]:
        m = re.search(r"ddm\." + field + r"\s*=\s*htmlDecode\s*\(\s*'([^']+)'", html)
        if m:
            raw = m.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#x27;", "'")
            result[field] = raw
    ps = re.search(r'name="dd-page-size"\s+content="([^"]+)"', html)
    result["ps"] = ps.group(1) if ps else "10504"
    return result


def _get_post_body(ddm: dict, iurl: str, js_url: str = "") -> dict | None:
    try:
        proc = subprocess.run(
            ["node", _RUNNER, json.dumps(ddm), iurl, js_url],
            capture_output=True, text=True, timeout=25, cwd=_DIR,
        )
    except subprocess.TimeoutExpired:
        print("    [Runner] Timeout!")
        return None

    stdout = proc.stdout.strip()
    if not stdout or proc.returncode != 0:
        return None

    try:
        cap = json.loads(stdout)
        if "error" in cap:
            return None
        return dict(urllib.parse.parse_qsl(cap.get("body", "")))
    except Exception:
        return None


def solve_interstitial(target_url: str = HOME_URL) -> dict:
    """
    Automatically solves a DataDome 403 interstitial challenge
    from the target URL and returns a valid datadome cookie.
    """
    s = cf.Session(impersonate=IMPERSONATE)
    r1 = s.get(target_url, allow_redirects=True, timeout=20)

    m = re.search(r"var dd=(\{[^}]+\})", r1.text)
    if not m:
        if r1.status_code == 200:
            return {
                "ok": True,
                "datadome": r1.cookies.get("datadome", ""),
                "uaid": r1.cookies.get("uaid", ""),
                "view": "already_ok",
            }
        return {"ok": False, "error": "var dd= challenge object not found."}

    dd_raw = m.group(1)
    dd = {f: _gf(dd_raw, f) for f in ["rt", "cid", "hsh", "b", "s", "e", "host", "t", "cookie", "r"]}

    dd_cookie = s.cookies.get("datadome", "") or dd.get("cookie", "")
    uaid = s.cookies.get("uaid", "")
    host = dd.get("host", "geo.captcha-delivery.com")

    if dd.get("rt") == "c":
        return {"ok": False, "error": "Slider Captcha required (rt: c)."}

    iframe_url = (
        f"https://{host}/interstitial/"
        f"?initialCid={urllib.parse.quote(dd['cid'])}"
        f"&hash={urllib.parse.quote(dd['hsh'])}"
        f"&cid={urllib.parse.quote(dd_cookie)}"
        f"&s={dd['s']}&e={urllib.parse.quote(dd['e'])}&b={dd['b']}&dm=cd"
        f"&referer={urllib.parse.quote(target_url)}"
    )

    cd = cf.Session(impersonate=IMPERSONATE)
    r2 = cd.get(iframe_url, headers={"Referer": target_url}, timeout=20)
    if r2.status_code != 200:
        return {"ok": False, "error": f"Interstitial page returned {r2.status_code}."}

    ddm = _parse_ddm(r2.text)
    js_m = re.search(r'src="(https://ct\.captcha-delivery\.com/interstitial\.[^"]+\.js)"', r2.text)
    js_url = js_m.group(1) if js_m else ""

    params = _get_post_body(ddm, iframe_url, js_url)
    if not params:
        return {"ok": False, "error": "Post body generation failed."}

    post_body = urllib.parse.urlencode(list(params.items()))
    r3 = cd.post(
        f"https://{host}/interstitial/",
        content=post_body.encode(),
        headers={
            "accept": "application/json, text/plain, */*",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "origin": f"https://{host}",
            "referer": iframe_url,
            "x-requested-with": "XMLHttpRequest",
        },
        timeout=20,
    )

    try:
        resp = r3.json()
    except Exception:
        return {"ok": False, "error": "JSON parse error"}

    view = resp.get("view", "")
    raw_cookie = resp.get("cookie", "")
    new_dd = ""
    if "datadome=" in raw_cookie:
        new_dd = raw_cookie.split("datadome=")[1].split(";")[0]

    return {
        "ok": view in ("redirect", "async"),
        "datadome": new_dd or dd_cookie,
        "uaid": uaid,
        "view": view,
    }


def test_cookie(datadome: str, target_url: str = HOME_URL) -> int:
    s = cf.Session(impersonate=IMPERSONATE)
    s.cookies.set("datadome", datadome, domain=".etsy.com")
    r = s.get(target_url, allow_redirects=True, timeout=20)
    return r.status_code


if __name__ == "__main__":
    res = solve_interstitial()
    print("Result:", res)
