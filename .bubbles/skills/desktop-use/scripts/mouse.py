#!/usr/bin/env python3
"""
Mouse control module for r-desktop-use.
"""

from utils import pyautogui


def click(x, y, button="left", clicks=1, interval=0.0):
    """Click at (x, y)."""
    pyautogui.click(x=x, y=y, button=button, clicks=clicks, interval=interval)
    return {"success": True, "action": "click", "x": x, "y": y, "button": button, "clicks": clicks}


def double_click(x, y, button="left"):
    """Double-click at (x, y)."""
    pyautogui.doubleClick(x=x, y=y, button=button)
    return {"success": True, "action": "double_click", "x": x, "y": y}


def mouse_down(button="left"):
    """Hold a mouse button down."""
    pyautogui.mouseDown(button=button)
    return {"success": True, "action": "mouse_down", "button": button}


def mouse_up(button="left"):
    """Release a held mouse button."""
    pyautogui.mouseUp(button=button)
    return {"success": True, "action": "mouse_up", "button": button}


def get_mouse_position():
    """Return the current mouse cursor position."""
    pos = pyautogui.position()
    return {"success": True, "x": pos.x, "y": pos.y}


def move_mouse(x, y, duration=0.0):
    """Move the mouse to an absolute position. Use duration > 0 for smooth movement."""
    pyautogui.moveTo(x=x, y=y, duration=duration)
    return {"success": True, "action": "move_mouse", "x": x, "y": y, "duration": duration}


def move_mouse_rel(x, y, duration=0.0):
    """Move the mouse relative to its current position."""
    pyautogui.moveRel(xOffset=x, yOffset=y, duration=duration)
    pos = pyautogui.position()
    return {"success": True, "action": "move_mouse_rel", "offset_x": x, "offset_y": y, "new_x": pos.x, "new_y": pos.y}


def drag_mouse(x, y, duration=0.5, button="left"):
    """Drag from the current position to (x, y)."""
    pyautogui.dragTo(x=x, y=y, duration=duration, button=button)
    return {"success": True, "action": "drag_mouse", "to_x": x, "to_y": y, "duration": duration}


def scroll(amount, x=None, y=None):
    """
    Scroll the mouse wheel. Positive = scroll up, negative = scroll down.
    Optionally move to (x, y) before scrolling.
    """
    if x is not None and y is not None:
        pyautogui.moveTo(x=x, y=y)
    pyautogui.scroll(amount)
    return {"success": True, "action": "scroll", "amount": amount}
