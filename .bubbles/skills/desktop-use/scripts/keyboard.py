#!/usr/bin/env python3
"""
Keyboard control module for r-desktop-use.
"""

import sys
import platform

from utils import pyautogui

# Use Cmd on macOS, Ctrl on Windows/Linux
_MOD = "command" if platform.system() == "Darwin" else "ctrl"


def type_text(text, interval=0.0):
    """Type a string of text. Use interval (seconds) between characters for slow apps."""
    pyautogui.typewrite(text, interval=interval)
    return {"success": True, "action": "type_text", "text": text}


def press_key(key):
    """Press and release a single key (e.g. 'enter', 'esc', 'tab', 'f5')."""
    pyautogui.press(key)
    return {"success": True, "action": "press_key", "key": key}


def hotkey(*keys):
    """Press a key combination simultaneously (e.g. 'ctrl', 'c')."""
    mapped_keys = ['command' if k in ['cmd', 'win'] else k for k in keys]
    pyautogui.hotkey(*mapped_keys)
    return {"success": True, "action": "hotkey", "keys": list(keys)}


# Common shortcuts — automatically use the right modifier for the platform

def copy():
    return hotkey(_MOD, "c")

def paste():
    return hotkey(_MOD, "v")

def cut():
    return hotkey(_MOD, "x")

def select_all():
    return hotkey(_MOD, "a")

def undo():
    return hotkey(_MOD, "z")

def redo():
    mod2 = "shift" if platform.system() == "Darwin" else _MOD
    key2 = "z" if platform.system() == "Darwin" else "y"
    return hotkey(_MOD, mod2, key2) if platform.system() == "Darwin" else hotkey(_MOD, key2)

def save():
    return hotkey(_MOD, "s")
