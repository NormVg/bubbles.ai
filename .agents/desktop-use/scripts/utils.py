#!/usr/bin/env python3
"""
Shared utilities for r-desktop-use automation scripts.
Handles dependency installation and common argument parsing helpers.
"""

import subprocess
import sys

pyautogui = None  # Lazily imported after ensuring deps


def ensure_dependencies():
    """Auto-install required packages if not already installed."""
    global pyautogui
    if pyautogui is not None:
        return

    try:
        import pyautogui as _pag
        pyautogui = _pag
    except ImportError:
        print("Installing pyautogui and pillow...", file=sys.stderr)
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", "pyautogui", "pillow"]
        )
        import pyautogui as _pag
        pyautogui = _pag

    # Safety settings
    pyautogui.FAILSAFE = True   # Move mouse to top-left to emergency-stop
    pyautogui.PAUSE = 0.1       # Small pause between actions


def parse_region(region_str):
    """Parse a region string like '100,200,400,300' into a tuple (x, y, w, h)."""
    if region_str is None:
        return None
    parts = [int(p.strip()) for p in region_str.split(",")]
    if len(parts) != 4:
        raise ValueError(f"Region must be 'x,y,width,height', got: {region_str!r}")
    return tuple(parts)


def parse_rgb(rgb_str):
    """Parse an RGB string like '255,128,0' into a tuple (r, g, b)."""
    parts = [int(p.strip()) for p in rgb_str.split(",")]
    if len(parts) != 3:
        raise ValueError(f"RGB must be 'r,g,b', got: {rgb_str!r}")
    return tuple(parts)
