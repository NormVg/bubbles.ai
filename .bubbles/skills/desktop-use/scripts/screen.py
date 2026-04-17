#!/usr/bin/env python3
"""
Screen module: screenshots and image recognition for r-desktop-use.
"""

import time
from pathlib import Path

from utils import pyautogui


def screenshot(output_path=None, region=None):
    """Take a screenshot and save it to a file."""
    if output_path is None:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        output_path = f"screenshot_{timestamp}.jpg"

    img = pyautogui.screenshot(region=region)
    if output_path.lower().endswith(".jpg") or output_path.lower().endswith(".jpeg"):
        img = img.convert("RGB")
        # Save highly compressed JPEG to speed up vision model processing
        img.save(output_path, "JPEG", quality=60, optimize=True)
    else:
        img.save(output_path)
    return {"success": True, "path": str(Path(output_path).resolve())}


def locate_on_screen(image_path, confidence=None, region=None):
    """Find an image on the screen and return its bounding box and center."""
    try:
        kwargs = {}
        if region is not None:
            kwargs["region"] = region
        if confidence is not None:
            kwargs["confidence"] = confidence

        location = pyautogui.locateOnScreen(image_path, **kwargs)

        if location:
            center = pyautogui.center(location)
            return {
                "success": True,
                "found": True,
                "left": int(location.left),
                "top": int(location.top),
                "width": int(location.width),
                "height": int(location.height),
                "center_x": int(center.x),
                "center_y": int(center.y),
            }
        return {"success": True, "found": False}
    except pyautogui.ImageNotFoundException:
        return {"success": False, "error": "Image not found on screen."}
    except Exception as e:
        return {"success": False, "error": f"{type(e).__name__}: {e}"}


def locate_all_on_screen(image_path, confidence=None, region=None):
    """Find all instances of an image on screen."""
    try:
        kwargs = {}
        if region is not None:
            kwargs["region"] = region
        if confidence is not None:
            kwargs["confidence"] = confidence

        locations = list(pyautogui.locateAllOnScreen(image_path, **kwargs))
        results = []
        for loc in locations:
            center = pyautogui.center(loc)
            results.append({
                "left": int(loc.left),
                "top": int(loc.top),
                "width": int(loc.width),
                "height": int(loc.height),
                "center_x": int(center.x),
                "center_y": int(center.y),
            })

        return {"success": True, "found_count": len(results), "locations": results}
    except Exception as e:
        return {"success": False, "error": str(e)}


def wait_for_image(image_path, confidence=None, region=None, timeout=10, interval=0.5):
    """Poll until an image appears on screen, or until timeout."""
    try:
        start = time.time()
        while time.time() - start < timeout:
            kwargs = {}
            if region is not None:
                kwargs["region"] = region
            if confidence is not None:
                kwargs["confidence"] = confidence

            location = pyautogui.locateOnScreen(image_path, **kwargs)
            if location:
                center = pyautogui.center(location)
                return {
                    "success": True,
                    "found": True,
                    "waited_seconds": round(time.time() - start, 2),
                    "left": int(location.left),
                    "top": int(location.top),
                    "width": int(location.width),
                    "height": int(location.height),
                    "center_x": int(center.x),
                    "center_y": int(center.y),
                }
            time.sleep(interval)

        return {
            "success": True,
            "found": False,
            "waited_seconds": timeout,
            "message": f"Timed out after {timeout}s — image never appeared.",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def wait_for_image_to_vanish(image_path, confidence=None, region=None, timeout=10, interval=0.5):
    """Poll until an image disappears from screen, or until timeout."""
    try:
        start = time.time()
        while time.time() - start < timeout:
            kwargs = {}
            if region is not None:
                kwargs["region"] = region
            if confidence is not None:
                kwargs["confidence"] = confidence

            location = pyautogui.locateOnScreen(image_path, **kwargs)
            if location is None:
                return {
                    "success": True,
                    "vanished": True,
                    "waited_seconds": round(time.time() - start, 2),
                }
            time.sleep(interval)

        return {
            "success": True,
            "vanished": False,
            "waited_seconds": timeout,
            "message": f"Timed out after {timeout}s — image is still visible.",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
