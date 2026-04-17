---
name: desktop-use
description: PyAutoGUI-powered desktop automation skill for controlling the user's screen. Use this skill whenever the user wants to automate desktop tasks, control mouse/keyboard, take screenshots, do GUI automation, run a perception loop (screenshot → reason → act), find UI elements by image, detect colors, or interact with any desktop application. Triggers include: "automate this", "click on X", "type text into Y", "take a screenshot", "find this button", "watch the screen", "control my desktop", "run a loop until X appears", or any task involving programmatic control of the user's computer.
---

# r-desktop-use

Desktop automation skill powered by PyAutoGUI. Provides a clean CLI for mouse, keyboard, screenshot, and image-recognition operations — plus a built-in **screenshot perception loop** so you can take a screenshot, reason about the current state of the screen, and act, iteratively.

**Script location:** `scripts/desktop.py`
**Usage:** `python scripts/desktop.py <action> [options]`
All actions return JSON. Errors exit with code 1 and print to stderr.

---

## Quick Start

```bash
# Install dependencies (auto-runs on first use)
pip install pyautogui pillow

# Take a screenshot, act on it
python scripts/desktop.py screenshot --output state.png
python scripts/desktop.py click --x 500 --y 300
python scripts/desktop.py type_text --text "Hello World"
```

---

## Screenshot Perception Loop

This is the core pattern for autonomous desktop control. There are two ways to run the loop:

### Option A — `loop.py` (recommended, auto-screenshots every step)

**Interactive REPL** — type one action at a time, screenshot happens automatically:
```bash
python scripts/loop.py
# then type commands like:
# ▶ action> click --x 500 --y 300
# ▶ action> type_text --text "hello"
# ▶ action> press_key --key enter
# ▶ action> q   (quit)
```

**JSON plan mode** — run a pre-planned sequence, screenshot between each step:
```bash
python scripts/loop.py --plan plan.json --output-dir /tmp/my_run
```

```json
[
  {"action": "hotkey", "keys": "cmd,space"},
  {"action": "sleep", "seconds": 0.5},
  {"action": "type_text", "text": "Terminal"},
  {"action": "press_key", "key": "enter"},
  {"action": "sleep", "seconds": 1.5}
]
```

Each action in the plan maps directly to a `desktop.py` action + its arguments. Screenshots are saved before step 1 and after every step, numbered `step_001_after_click.png` etc.

### Option B — Manual loop with `desktop.py`

```bash
# Capture current state
python scripts/desktop.py screenshot --output /tmp/step1.png

# Act based on what you saw
python scripts/desktop.py click --x 742 --y 388
python scripts/desktop.py sleep --seconds 0.8

# Screenshot again to verify
python scripts/desktop.py screenshot --output /tmp/step2.png
```

**Why screenshotting every step matters:** Desktop UIs are stateful — elements take time to render, dialogs pop up unexpectedly, spinners appear. Screenshot → reason → act → screenshot again keeps you grounded in what's actually on screen, not what you assumed would be there.

**Loop pseudocode:**
```
for each step:
  1. screenshot → see actual current state
  2. reason: what is visible? what is the goal? next atomic action?
  3. execute one action (click / type / key)
  4. sleep 0.5–1s
  5. screenshot again → did it work? new dialog? state changed?
  6. if goal reached → stop. else → repeat.
```

---

## All Actions

### Screenshots

```bash
# Full-screen screenshot (auto filename)
python scripts/desktop.py screenshot

# Specify output path
python scripts/desktop.py screenshot --output /tmp/before.png

# Region screenshot (x, y, width, height)
python scripts/desktop.py screenshot --output /tmp/region.png --region 100,100,400,300
```

### Mouse

```bash
# Left-click at (x, y)
python scripts/desktop.py click --x 500 --y 300

# Right-click
python scripts/desktop.py click --x 500 --y 300 --button right

# Double-click
python scripts/desktop.py double_click --x 500 --y 300

# Get current mouse position
python scripts/desktop.py get_mouse_position

# Move mouse (instant or animated)
python scripts/desktop.py move_mouse --x 800 --y 400
python scripts/desktop.py move_mouse --x 800 --y 400 --duration 0.5

# Move mouse relative to current position
python scripts/desktop.py move_mouse_rel --x 100 --y -50

# Drag from current position to (x, y)
python scripts/desktop.py drag_mouse --x 900 --y 500 --duration 1.0

# Hold / release mouse button
python scripts/desktop.py mouse_down --button left
python scripts/desktop.py mouse_up --button left

# Scroll (positive = up, negative = down)
python scripts/desktop.py scroll --amount 500
python scripts/desktop.py scroll --amount -300 --x 600 --y 400
```

### Keyboard

```bash
# Type text
python scripts/desktop.py type_text --text "Hello World"

# Type with delay between keystrokes (good for slow apps)
python scripts/desktop.py type_text --text "slower input" --interval 0.05

# Press a single key
python scripts/desktop.py press_key --key enter
python scripts/desktop.py press_key --key esc
python scripts/desktop.py press_key --key tab

# Hotkey / combo
python scripts/desktop.py hotkey --keys ctrl,c
python scripts/desktop.py hotkey --keys ctrl,shift,t
python scripts/desktop.py hotkey --keys cmd,space      # macOS Spotlight

# Shortcuts
python scripts/desktop.py copy        # Ctrl+C / Cmd+C
python scripts/desktop.py paste       # Ctrl+V / Cmd+V
python scripts/desktop.py cut         # Ctrl+X / Cmd+X
python scripts/desktop.py select_all  # Ctrl+A / Cmd+A
python scripts/desktop.py undo        # Ctrl+Z / Cmd+Z
python scripts/desktop.py redo        # Ctrl+Y / Cmd+Y
python scripts/desktop.py save        # Ctrl+S / Cmd+S
```

Common key names: `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `up`, `down`, `left`, `right`, `f1`–`f12`, `ctrl`, `alt`, `shift`, `win`, `cmd`, `option`

### Image Recognition (requires `opencv-python`)

```bash
# Find an image on screen — returns center coordinates
python scripts/desktop.py locate_on_screen --image button.png

# With confidence threshold (0.0–1.0)
python scripts/desktop.py locate_on_screen --image button.png --confidence 0.85

# Find in a specific region
python scripts/desktop.py locate_on_screen --image icon.png --region 0,0,800,600

# Find all matches
python scripts/desktop.py locate_all_on_screen --image icon.png

# Wait until an image appears (up to timeout seconds)
python scripts/desktop.py wait_for_image --image loading.png --timeout 15

# Wait until an image disappears
python scripts/desktop.py wait_for_image_to_vanish --image spinner.png --timeout 30
```

Install for image recognition: `pip install opencv-python`

### Color Detection

```bash
# Get pixel color at (x, y) → returns RGB + hex
python scripts/desktop.py get_pixel_color --x 100 --y 200

# Find a color anywhere on screen
python scripts/desktop.py find_color --rgb 255,0,0

# Find with tolerance (useful for anti-aliased edges)
python scripts/desktop.py find_color --rgb 255,100,50 --tolerance 20

# Find within a region
python scripts/desktop.py find_color --rgb 0,128,255 --region 0,0,1920,540
```

### Screen & System Info

```bash
# Get screen resolution
python scripts/desktop.py get_screen_size

# Get active window info (requires pywin32 on Windows)
python scripts/desktop.py get_active_window

# List all visible windows (requires pywin32 on Windows)
python scripts/desktop.py get_all_windows

# Sleep/wait
python scripts/desktop.py sleep --seconds 1.5
```

---

## Complete Workflow Examples

### Example: Open an App and Type

```bash
# 1. Screenshot — see what's on screen now
python scripts/desktop.py screenshot --output /tmp/s1.png

# 2. Open Spotlight (macOS) / Start (Windows)
python scripts/desktop.py hotkey --keys cmd,space

# 3. Screenshot — verify Spotlight opened
python scripts/desktop.py screenshot --output /tmp/s2.png

# 4. Type the app name
python scripts/desktop.py type_text --text "Terminal"
python scripts/desktop.py press_key --key enter

# 5. Wait for app to open
python scripts/desktop.py sleep --seconds 1.5

# 6. Screenshot — confirm app opened
python scripts/desktop.py screenshot --output /tmp/s3.png
```

### Example: Find and Click a Button

```bash
# 1. Screenshot to orient yourself
python scripts/desktop.py screenshot --output /tmp/before.png

# 2. Find the submit button by image
result=$(python scripts/desktop.py locate_on_screen --image submit_btn.png --confidence 0.9)
# result contains: center_x, center_y

# 3. Click the center of the found button
python scripts/desktop.py click --x $(echo $result | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['center_x'])") \
                                --y $(echo $result | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['center_y'])")

# 4. Screenshot to confirm the click worked
python scripts/desktop.py screenshot --output /tmp/after.png
```

### Example: Form Fill Automation

```bash
python scripts/desktop.py screenshot --output /tmp/form_before.png
python scripts/desktop.py click --x 400 --y 250      # click name field
python scripts/desktop.py type_text --text "Jane Doe"
python scripts/desktop.py press_key --key tab        # move to next field
python scripts/desktop.py type_text --text "jane@example.com"
python scripts/desktop.py press_key --key tab
python scripts/desktop.py type_text --text "secret123"
python scripts/desktop.py screenshot --output /tmp/form_filled.png
python scripts/desktop.py click --x 400 --y 450      # submit button
python scripts/desktop.py sleep --seconds 2
python scripts/desktop.py screenshot --output /tmp/form_after.png
```

---

## Safety & Tips

- **FAILSAFE**: Moving the mouse to the top-left corner of the screen triggers an emergency stop (pyautogui built-in).
- **Default pause**: 0.1 seconds between actions — enough for most UIs but you can add `sleep` calls for slow apps.
- **Coordinate system**: Top-left is (0, 0). X increases right, Y increases down.
- **Multi-monitor**: Coordinates can exceed your primary screen's resolution — they span all displays.
- **Retina/HiDPI (macOS)**: Pyautogui works in logical pixels. If image recognition fails, try capturing reference images on the same machine.
- **Screenshot before acting**: In autonomous loops, always screenshot before each action. UI state can change unexpectedly — you want to see what you're working with, not assume.

---

## Dependencies

Auto-installed on first run:
- `pyautogui` — core automation
- `pillow` — image handling

Optional (for image recognition confidence threshold):
```bash
pip install opencv-python
```

## Resource Index

- [desktop.py](scripts/desktop.py) — main CLI entry point
- [loop.py](scripts/loop.py) — **screenshot perception loop** (interactive REPL + JSON plan runner)
- [screen.py](scripts/screen.py) — screenshots & image recognition
- [mouse.py](scripts/mouse.py) — mouse control
- [keyboard.py](scripts/keyboard.py) — keyboard control
- [color.py](scripts/color.py) — color detection
- [system.py](scripts/system.py) — screen size, window info, sleep
- [utils.py](scripts/utils.py) — shared utilities & dependency management
