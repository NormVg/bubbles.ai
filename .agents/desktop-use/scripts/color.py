#!/usr/bin/env python3
"""
Color detection module for r-desktop-use.
"""

from utils import pyautogui


def get_pixel_color(x, y):
    """Get the RGB color of a pixel at (x, y)."""
    screenshot = pyautogui.screenshot()
    r, g, b = screenshot.getpixel((x, y))
    hex_color = "#{:02x}{:02x}{:02x}".format(r, g, b)
    return {"success": True, "x": x, "y": y, "rgb": [r, g, b], "hex": hex_color}


def find_color(target_rgb, region=None, tolerance=0):
    """
    Search the screen for a pixel matching target_rgb.
    tolerance: maximum allowed difference per channel (0 = exact match).
    Returns the first matching (x, y) coordinate, or found=False.
    """
    screenshot = pyautogui.screenshot(region=region)
    tr, tg, tb = target_rgb

    offset_x = region[0] if region else 0
    offset_y = region[1] if region else 0

    width, height = screenshot.size
    for py in range(height):
        for px in range(width):
            r, g, b = screenshot.getpixel((px, py))
            if (
                abs(r - tr) <= tolerance
                and abs(g - tg) <= tolerance
                and abs(b - tb) <= tolerance
            ):
                return {
                    "success": True,
                    "found": True,
                    "x": px + offset_x,
                    "y": py + offset_y,
                    "rgb": [r, g, b],
                }

    return {"success": True, "found": False, "target_rgb": list(target_rgb)}
