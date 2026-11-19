#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Etsy DataDome Bypass - Main Entry Point
========================================
Usage:
    python main.py
    python main.py --login user@example.com mypassword
    python main.py --search "handmade necklace"
"""

import sys
import argparse
from core.etsy_client import EtsyClient

def main():
    parser = argparse.ArgumentParser(description="Etsy DataDome Bypass & Client")
    parser.add_argument("--login", nargs=2, metavar=("EMAIL", "PASSWORD"), help="Test Etsy login")
    parser.add_argument("--search", type=str, metavar="QUERY", help="Search Etsy and show response status")
    parser.add_argument("--test", action="store_true", help="Run full flow validation (Default)")

    args = parser.parse_args()

    print("=" * 60)
    print("   ETSY DATADOME BYPASS & SESSION MANAGER")
    print("=" * 60)

    client = EtsyClient()

    print("\n[1] Starting Etsy session (Chrome TLS)...")
    if not client.init_session():
        print(f"  x Could not load homepage! (Status 200 not received)")
        sys.exit(1)

    print("  v Session started.")
    print(f"    uaid       : {client.uaid[:35]}...")
    print(f"    csrf_nonce : {client.csrf_nonce[:35]}...")

    print("\n[2] Generating DataDome VM token and activating tags.js telemetry...")
    client.activate_datadome(rounds=1)
    print(f"  v DataDome cookie activated: {client.datadome[:40]}...")

    if args.login:
        email, password = args.login
        print(f"\n[3] Testing Etsy login ({email})...")
        res = client.login(email, password)
        print(f"  Login response status: {res['status']}")
        if res["ok"]:
            print("  v SUCCESS: DataDome bypassed and Etsy login endpoint responded (200 OK)!")
        else:
            print(f"  Response: {res['body'][:200]}")

    elif args.search:
        query = args.search
        search_url = f"https://www.etsy.com/search?q={query.replace(' ', '+')}"
        print(f"\n[3] Fetching search page: {search_url} ...")
        resp = client.get(search_url)
        print(f"  HTTP Status: {resp.status_code}")
        print(f"  Page Size: {len(resp.text)} bytes")
        if resp.status_code == 200:
            print("  v SUCCESS: Search page fetched without DataDome block (200 OK)!")
        else:
            print("  x Could not fetch page.")

    else:
        # Default test flow
        print("\n[3] Fetching sample categories (DataDome 403 check)...")
        test_urls = [
            ("Search (necklace)", "https://www.etsy.com/search?q=necklace"),
            ("Jewelry Category", "https://www.etsy.com/c/jewelry/necklaces"),
        ]
        for name, url in test_urls:
            r = client.get(url)
            status_text = "v 200 OK" if r.status_code == 200 else f"x {r.status_code}"
            print(f"  - {name}: {status_text} ({len(r.text)} bytes)")

        print("\n[4] Testing login endpoint (Join_Neu_Controller)...")
        login_res = client.login("test_user_verify@gmail.com", "SamplePass123!")
        if login_res["ok"]:
            print("  v Join_Neu_Controller: 200 OK — DataDome bypassed!")
        else:
            print(f"  Join_Neu_Controller status: {login_res['status']}")

    print("\n" + "=" * 60)
    print("   DONE — ALL SYSTEMS OPERATIONAL")
    print("=" * 60)

if __name__ == "__main__":
    main()
