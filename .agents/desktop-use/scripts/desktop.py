#!/usr/bin/env python3
"""
r-desktop-use — Desktop automation CLI
Usage: python scripts/desktop.py <action> [options]
All actions return JSON. Errors exit with code 1.
"""

import argparse
import json
import sys
import os

# Add the scripts directory to path so modules can be imported cleanly
sys.path.insert(0, os.path.dirname(__file__))

from utils import ensure_dependencies, parse_region, parse_rgb

# Ensure pyautogui is installed before importing modules that need it
ensure_dependencies()

import color
import keyboard
import mouse
import screen
import system

# ─── Action registry ──────────────────────────────────────────────────────────

ACTIONS = {
    # Screenshots
    "screenshot": lambda a: screen.screenshot(a.output, parse_region(a.region)),

    # Mouse
    "click": lambda a: mouse.click(a.x, a.y, a.button, a.clicks, a.interval),
    "double_click": lambda a: mouse.double_click(a.x, a.y, a.button),
    "mouse_down": lambda a: mouse.mouse_down(a.button),
    "mouse_up": lambda a: mouse.mouse_up(a.button),
    "get_mouse_position": lambda a: mouse.get_mouse_position(),
    "move_mouse": lambda a: mouse.move_mouse(a.x, a.y, a.duration),
    "move_mouse_rel": lambda a: mouse.move_mouse_rel(a.x, a.y, a.duration),
    "drag_mouse": lambda a: mouse.drag_mouse(a.x, a.y, a.duration, a.button),
    "scroll": lambda a: mouse.scroll(a.amount, a.x, a.y),

    # Keyboard
    "type_text": lambda a: keyboard.type_text(a.text, a.interval),
    "press_key": lambda a: keyboard.press_key(a.key),
    "hotkey": lambda a: keyboard.hotkey(*a.keys.split(",")),
    "copy": lambda a: keyboard.copy(),
    "paste": lambda a: keyboard.paste(),
    "cut": lambda a: keyboard.cut(),
    "select_all": lambda a: keyboard.select_all(),
    "undo": lambda a: keyboard.undo(),
    "redo": lambda a: keyboard.redo(),
    "save": lambda a: keyboard.save(),

    # Image recognition
    "locate_on_screen": lambda a: screen.locate_on_screen(
        a.image, a.confidence, parse_region(a.region)
    ),
    "locate_all_on_screen": lambda a: screen.locate_all_on_screen(
        a.image, a.confidence, parse_region(a.region)
    ),
    "wait_for_image": lambda a: screen.wait_for_image(
        a.image, a.confidence, parse_region(a.region), a.timeout, a.wait_interval
    ),
    "wait_for_image_to_vanish": lambda a: screen.wait_for_image_to_vanish(
        a.image, a.confidence, parse_region(a.region), a.timeout, a.wait_interval
    ),

    # Color
    "get_pixel_color": lambda a: color.get_pixel_color(a.x, a.y),
    "find_color": lambda a: color.find_color(
        parse_rgb(a.rgb), parse_region(a.region), a.tolerance
    ),

    # System
    "get_screen_size": lambda a: system.get_screen_size(),
    "get_active_window": lambda a: system.get_active_window(),
    "get_all_windows": lambda a: system.get_all_windows(),
    "sleep": lambda a: system.sleep(a.seconds),
}

# Parameters required per action (for early validation)
REQUIRED = {
    "click": ["x", "y"],
    "double_click": ["x", "y"],
    "get_pixel_color": ["x", "y"],
    "move_mouse": ["x", "y"],
    "move_mouse_rel": ["x", "y"],
    "drag_mouse": ["x", "y"],
    "scroll": ["amount"],
    "find_color": ["rgb"],
    "sleep": ["seconds"],
    "type_text": ["text"],
    "press_key": ["key"],
    "hotkey": ["keys"],
    "locate_on_screen": ["image"],
    "locate_all_on_screen": ["image"],
    "wait_for_image": ["image"],
    "wait_for_image_to_vanish": ["image"],
}

# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_parser():
    p = argparse.ArgumentParser(
        prog="desktop.py",
        description="r-desktop-use: PyAutoGUI desktop automation CLI. All outputs are JSON.",
    )
    p.add_argument("action", choices=list(ACTIONS.keys()), help="Action to perform")

    # Coordinates
    p.add_argument("--x", type=int, help="X coordinate")
    p.add_argument("--y", type=int, help="Y coordinate")

    # Mouse options
    p.add_argument("--button", default="left", choices=["left", "right", "middle"])
    p.add_argument("--clicks", type=int, default=1, help="Number of clicks")
    p.add_argument("--duration", type=float, default=0.0, help="Movement duration (seconds)")
    p.add_argument("--amount", type=int, help="Scroll amount (positive=up, negative=down)")

    # Keyboard
    p.add_argument("--text", help="Text to type")
    p.add_argument("--key", help="Key name (e.g. 'enter', 'esc', 'tab')")
    p.add_argument("--keys", help="Hotkey combo, comma-separated (e.g. 'ctrl,c')")
    p.add_argument("--interval", type=float, default=0.0, help="Delay between keystrokes (seconds)")

    # Screenshot / image
    p.add_argument("--output", help="Output file path for screenshots")
    p.add_argument("--region", help="Region as x,y,width,height (e.g. '0,0,800,600')")
    p.add_argument("--image", help="Path to reference image file for recognition")
    p.add_argument("--confidence", type=float, help="Match confidence 0–1 (requires opencv-python)")

    # Color
    p.add_argument("--rgb", help="Target color as R,G,B (e.g. '255,0,128')")
    p.add_argument("--tolerance", type=int, default=0, help="Color match tolerance per channel")

    # Timing
    p.add_argument("--seconds", type=float, help="Sleep duration in seconds")
    p.add_argument("--timeout", type=float, default=10.0, help="Timeout for wait actions (seconds)")
    p.add_argument("--wait_interval", type=float, default=0.5, help="Poll interval for wait actions (seconds)")

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()

    # Validate required params
    missing = [p for p in REQUIRED.get(args.action, []) if getattr(args, p, None) is None]
    if missing:
        print(
            json.dumps({
                "success": False,
                "error": f"Action '{args.action}' requires: {', '.join('--' + m for m in missing)}"
            }),
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        result = ACTIONS[args.action](args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result.get("success", True):
            sys.exit(1)
    except Exception as e:
        print(
            json.dumps({"success": False, "error": f"{type(e).__name__}: {e}"}),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
