#!/usr/bin/env python3
"""
System information module for r-desktop-use.
"""

import platform
import time

from utils import pyautogui


def get_screen_size():
    """Return the primary screen resolution."""
    width, height = pyautogui.size()
    return {"success": True, "width": width, "height": height}


def get_active_window():
    """
    Return info about the currently focused window.
    Requires pywin32 on Windows. On macOS/Linux returns a basic result.
    """
    system = platform.system()

    if system == "Windows":
        try:
            import win32gui
            hwnd = win32gui.GetForegroundWindow()
            title = win32gui.GetWindowText(hwnd)
            rect = win32gui.GetWindowRect(hwnd)
            return {
                "success": True,
                "title": title,
                "left": rect[0],
                "top": rect[1],
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1],
            }
        except ImportError:
            return {"success": False, "error": "win32gui not available. Install pywin32."}
    elif system == "Darwin":
        try:
            import subprocess
            script = 'tell application "System Events" to get name of first application process whose frontmost is true'
            result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
            return {"success": True, "title": result.stdout.strip(), "platform": "macOS"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    else:
        return {"success": False, "error": f"get_active_window not supported on {system}."}


def get_all_windows():
    """List all visible windows (Windows only, requires pywin32)."""
    if platform.system() != "Windows":
        return {"success": False, "error": "get_all_windows is only supported on Windows."}
    try:
        import win32gui
        windows = []

        def enum_handler(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title:
                    rect = win32gui.GetWindowRect(hwnd)
                    windows.append({
                        "hwnd": hwnd,
                        "title": title,
                        "left": rect[0],
                        "top": rect[1],
                        "width": rect[2] - rect[0],
                        "height": rect[3] - rect[1],
                    })

        win32gui.EnumWindows(enum_handler, None)
        return {"success": True, "count": len(windows), "windows": windows}
    except ImportError:
        return {"success": False, "error": "pywin32 not installed. Run: pip install pywin32"}


def sleep(seconds):
    """Pause execution for the given number of seconds."""
    time.sleep(seconds)
    return {"success": True, "slept_seconds": seconds}
