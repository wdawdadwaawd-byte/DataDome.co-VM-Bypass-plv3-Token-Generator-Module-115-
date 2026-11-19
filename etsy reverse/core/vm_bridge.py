#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DataDome VM Bridge
==================
Bridge between Python and the DataDome Module 115 Virtual Machine (VM) runner.
Executes run_vm.js via Node.js and returns the generated plv3 (r) and tagx (i)
values as a Python dictionary.
"""

import os
import sys
import json
import subprocess

def _find_vm_dir() -> str:
    """Automatically locates the datadome-vm-main directory."""
    env_dir = os.environ.get("DATADOME_VM_DIR")
    if env_dir and os.path.isdir(env_dir):
        return os.path.abspath(env_dir)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.normpath(os.path.join(base_dir, "..", "..", "datadome-vm-main")),
        os.path.normpath(os.path.join(base_dir, "..", "datadome-vm-main")),
        os.path.normpath(os.path.join(base_dir, "datadome-vm-main")),
        r"C:\Users\WASDW\Desktop\datadome-vm-main",
    ]
    for c in candidates:
        if os.path.isfile(os.path.join(c, "run_vm.js")):
            return c
    raise FileNotFoundError(
        "datadome-vm-main directory and run_vm.js not found! "
        "Please set the DATADOME_VM_DIR environment variable."
    )


def get_vm_token(user_env: str = "yes", timeout: int = 20) -> dict:
    """
    Runs the DataDome VM and returns the security tokens.

    Args:
        user_env: ddm.userEnv or control parameter ('yes')
        timeout: Maximum execution time in seconds

    Returns:
        dict: {
            'r': str,        # VM token (plv3 value)
            'i': int,        # instruction count (tagx signal)
            't': int,        # execution time (ms)
            'u': str | None  # optional signal
        }
    """
    vm_dir = _find_vm_dir()
    vm_js = os.path.join(vm_dir, "run_vm.js")

    try:
        proc = subprocess.run(
            ["node", vm_js, user_env],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=vm_dir,
        )
    except FileNotFoundError:
        raise RuntimeError("'node' (Node.js) command not found on the system!")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"DataDome VM did not respond within {timeout} seconds (Timeout).")

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    if not stdout:
        raise RuntimeError(f"VM produced no output. Error: {stderr[:200]}")

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"VM output could not be parsed as JSON: {stdout[:100]} — {e}")

    if "error" in data:
        raise RuntimeError(f"VM runtime error: {data['error']}")

    if "r" not in data:
        raise RuntimeError(f"VM response missing 'r' (plv3) key: {data}")

    return {
        "r": data.get("r"),
        "i": data.get("i", 0),
        "t": data.get("t", 0),
        "u": data.get("u"),
    }


if __name__ == "__main__":
    try:
        tok = get_vm_token("yes")
        print("v VM Token retrieved successfully:")
        print(f"  plv3 (r)  : {tok['r'][:50]}...")
        print(f"  tagx (i)  : {tok['i']}")
        print(f"  time (t)  : {tok['t']} ms")
    except Exception as exc:
        print(f"x Error: {exc}")
        sys.exit(1)
