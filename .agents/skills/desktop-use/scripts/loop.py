#!/usr/bin/env python3
"""
r-desktop-use: Screenshot Perception Loop
==========================================
A runnable perception loop that:
  1. Takes a screenshot and saves it
  2. Prints the path so you (or an AI agent) can view the current screen state
  3. Waits for a shell command to run (click, type, key, etc.)
  4. Executes it via desktop.py
  5. Sleeps briefly, then loops

Usage:
    # Interactive mode — prompts you for each action
    python scripts/loop.py

    # Auto mode — run a sequence of actions from a JSON file, screenshot between each
    python scripts/loop.py --plan plan.json --output-dir /tmp/loop_run

Plan JSON format:
    [
      {"action": "hotkey", "keys": "command,space"},
      {"action": "sleep", "seconds": 0.5},
      {"action": "type_text", "text": "Terminal"},
      {"action": "press_key", "key": "enter"},
      {"action": "sleep", "seconds": 1.5}
    ]

Each entry maps directly to a desktop.py action + its arguments.
A screenshot is automatically taken before the first step and after every step.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DESKTOP = SCRIPT_DIR / "desktop.py"


def run_action(action_dict: dict, output_dir: Path, step: int) -> dict:
    """Build and run a desktop.py command from an action dict. Returns parsed JSON result."""
    action = action_dict.get("action")
    if not action:
        return {"success": False, "error": "Missing 'action' key in step."}

    cmd = [sys.executable, str(DESKTOP), action]

    # Map all other keys to --flag values
    for key, val in action_dict.items():
        if key == "action":
            continue
        cmd += [f"--{key}", str(val)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(result.stdout or result.stderr or '{"success": false}')
    except json.JSONDecodeError:
        return {"success": False, "raw_stdout": result.stdout, "raw_stderr": result.stderr}


def take_screenshot(output_dir: Path, label: str) -> str:
    """Take a screenshot and return the path."""
    path = output_dir / f"{label}.png"
    cmd = [sys.executable, str(DESKTOP), "screenshot", "--output", str(path)]
    subprocess.run(cmd, capture_output=True)
    return str(path)


def run_plan(plan: list, output_dir: Path):
    """Execute a list of action steps, screenshotting before and after each."""
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n📸 r-desktop-use perception loop — {len(plan)} steps\n{'─'*50}")

    # Screenshot before anything
    shot = take_screenshot(output_dir, "step_000_before")
    print(f"[init]  screenshot → {shot}")

    for i, step in enumerate(plan, start=1):
        label_before = f"step_{i:03d}_before"
        label_after  = f"step_{i:03d}_after"

        action_name = step.get("action", "?")
        print(f"\n[{i}/{len(plan)}] action: {json.dumps(step)}")

        # Run the action
        result = run_action(step, output_dir, i)
        success = result.get("success", True)
        status = "✅" if success else "❌"
        print(f"        {status}  result: {json.dumps(result)}")

        # Small pause then screenshot
        time.sleep(0.6)
        shot = take_screenshot(output_dir, label_after)
        print(f"        📸 screenshot → {shot}")

    print(f"\n{'─'*50}")
    print(f"✅ Loop complete. Screenshots saved to: {output_dir}")


def interactive_loop(output_dir: Path):
    """
    Interactive REPL loop.
    Type desktop.py action args (without 'python desktop.py') e.g.:
        click --x 500 --y 300
        type_text --text "hello"
        press_key --key enter
        q  (to quit)
    A screenshot is taken before the first prompt and after each command.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    step = 0

    shot = take_screenshot(output_dir, f"step_{step:03d}_init")
    print(f"\n📸 r-desktop-use interactive loop")
    print(f"   Screenshot saved: {shot}")
    print(f"   Type desktop.py commands (e.g. 'click --x 500 --y 300') or 'q' to quit.\n")

    while True:
        try:
            raw = input("▶ action> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting loop.")
            break

        if raw.lower() in ("q", "quit", "exit"):
            print("Loop ended.")
            break

        if not raw:
            continue

        step += 1
        parts = raw.split()
        action = parts[0]
        rest = parts[1:]

        # Build an action dict from the raw input
        action_dict = {"action": action}
        i = 0
        while i < len(rest):
            if rest[i].startswith("--"):
                key = rest[i][2:]
                val = rest[i + 1] if i + 1 < len(rest) else ""
                action_dict[key] = val
                i += 2
            else:
                i += 1

        result = run_action(action_dict, output_dir, step)
        success = result.get("success", True)
        print(f"  {'✅' if success else '❌'} {json.dumps(result)}")

        time.sleep(0.6)
        shot = take_screenshot(output_dir, f"step_{step:03d}_after_{action}")
        print(f"  📸 {shot}\n")


def main():
    parser = argparse.ArgumentParser(
        description="r-desktop-use screenshot perception loop"
    )
    parser.add_argument(
        "--plan", help="Path to a JSON plan file (list of action dicts)"
    )
    parser.add_argument(
        "--output-dir", default="/tmp/r_desktop_loop",
        help="Directory to save screenshots (default: /tmp/r_desktop_loop)"
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)

    if args.plan:
        with open(args.plan) as f:
            plan = json.load(f)
        run_plan(plan, output_dir)
    else:
        interactive_loop(output_dir)


if __name__ == "__main__":
    main()
