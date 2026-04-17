---
name: fast-scripted-desktop
description: "How to automate robust, multi-step desktop and browser tasks using one-shot PyAutoGUI python scripts. Make sure to use this skill whenever the user explicitly asks for scripts or fast desktop automation, or when you notice a task is highly repetitive and step-by-step tool calls would be too slow."
---

# Fast Scripted Desktop Automation

Instead of using individual desktop tools (`desktopClick`, `desktopType`, `desktopScreenshot`) step-by-step, you will write a self-contained Python script using `pyautogui` and `time.sleep()` to execute the user's requested desktop automation rapidly in a single sprint.

This approach is exponentially faster when you know exactly what UI elements to click, what text to type, or what hotkeys to press.

## Protocol

### 1. Vision & Coordinate Calibration
If you do not know the coordinates of the buttons/inputs you need to interact with:
- First take a **single baseline screenshot** (`desktopScreenshot` tool).
- Analyze the screenshot (`visionAnalyze` tool). **ALWAYS pass a specific `question` parameter** (e.g. "What are the exact (X,Y) coordinates of the 'Log In' button?"). Never run a blind analysis without a targeted question.

### 2. Script Generation
Write a Python script locally in the workspace (e.g., `automation_script.py`).
**Important scripting rules:**
- Import `pyautogui`, `time`, and any other standard libraries.
- Rely on PyAutoGUI's keyboard shortcuts, like `pyautogui.hotkey('command', 'space')`, over explicitly finding icons. Hotkeys are significantly faster and 100% reliable.
- Add generous `time.sleep(1)` or `time.sleep(2)` pauses between major actions (e.g., opening an app, waiting for a pageload, submitting a form) to ensure the system catches up. UI transitions take time.
- **Basic IO**: `pyautogui.click(x, y)`, `pyautogui.doubleClick(x, y)`, `pyautogui.rightClick(x, y)`, and `pyautogui.write('text')`.
- **Advanced Control**:
  - `pyautogui.scroll(amount, x=x, y=y)` to scroll interfaces.
  - `pyautogui.dragTo(x, y, duration=1)` to drag-and-drop elements.
- **Visual Intelligence**: Sub-skills for robust state verification:
  - `pyautogui.pixelMatchesColor(x, y, (R, G, B), tolerance=10)` to check if a checkbox is checked, a button is enabled, a theme is dark, etc.
  - `pyautogui.locateCenterOnScreen('reference.png', confidence=0.8)` to find dynamic visual elements if you have created a reference crop image. (Requires `pyscreeze` / `opencv-python` depending on confidence).
- **CRITICAL: You are on macOS.** NEVER use `cmd` or `win` as a modifier key. You MUST use `command` (e.g. `pyautogui.hotkey('command', 'c')`). Other valid keys are `option`, `control`, `shift`. NEVER guess keyboard key strings without checking PyAutoGUI docs.

**Example Script (`run_automation.py`):**
```python

import pyautogui
import time

print("Starting automation...")

# Open Zen Browser via Spotlight
pyautogui.hotkey('command', 'space')
time.sleep(0.5)
pyautogui.write('Zen Browser')
time.sleep(0.5)
pyautogui.press('enter')
time.sleep(3) # wait for browser

# Open a new tab
pyautogui.hotkey('command', 't')
time.sleep(1)

# Navigate to URL
pyautogui.write('https://x.com/')
pyautogui.press('enter')
time.sleep(5) # Wait for page load

print("Done!")

```

### 3. Execution & Checkpointing (Phases)
Do not write one monolithic script that relies on blind luck. UIs are dynamic and this is extremely brittle.
**FORBIDDEN PATTERNS:**
- 🚫 Pressing `tab` or `arrow` keys multiple times sequentially assuming the UI layout never changes.
- 🚫 Blindly scrolling N times without a way to verify the target element is visible.
- 🚫 Relying *exclusively* on `time.sleep(5)` for major page loads without subsequent verification.

**ROBUST PATTERNS:**
- ✅ **Use App Hotkeys:** Pressing `command+enter` to post/submit is universally supported and 100x safer than tabbing.
- ✅ **Dynamic Verification:** Use `pyautogui.pixelMatchesColor()` to check if a UI state is ready (e.g., button turned blue).
- ✅ **Dynamic Loading Checks:** After an action causes navigation or loading, NEVER assume `time.sleep(5)` guarantees the page loaded. You must either dynamically wait for a pixel color/state, or immediately end the script phase and use `desktopScreenshot` to verify layout visually.
- ✅ **Micro-Scripts / Checkpoints:** For complex multi-step flows, write Phase 1 (`script_p1_open.py`), run it, take a screenshot manually using `desktopScreenshot` tool to verify the state and grab the new precise coordinates, and THEN write Phase 2 (`script_p2_click.py`).

- Run your script using the `shell` tool: `python3 run_automation.py`.
- If the script fails, debug the stack trace and re-run.

### 4. Verification Check
- After the script finishes executing, take a brand new screenshot (`desktopScreenshot` tool).
- Visually verify that the end-state matches the user's intent (e.g. "Did the tweet post?", "Is the browser open to the right page?").
- If the verification fails (e.g. it clicked the wrong place because of a popup or timing issue), figure out what went wrong, inject a fix in the Python script, and run it again.

## Why this works
Step-by-step automation pauses to think after every single click, which on macOS retina setups requires large image parsing taking 10-30 seconds per loop. A PyAutoGUI script fires keystrokes and clicks instantly, achieving the goal in ~10 seconds flat. Verification ensures quality control.
