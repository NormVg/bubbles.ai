#!/usr/bin/env python3
from datetime import datetime
import json
import sys

try:
    from zoneinfo import ZoneInfo
except ImportError:
    import pytz
    ZoneInfo = pytz.timezone

def get_time(timezone):
    """Get current time in the specified timezone."""
    try:
        tz = ZoneInfo(timezone)
        now = datetime.now(tz)
        return {
            "success": True,
            "timezone": timezone,
            "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%I:%M:%S %p"),
            "iso": now.isoformat()
        }
    except Exception as e:
        return {"success": False, "error": f"Invalid timezone '{timezone}': {str(e)}"}

if __name__ == "__main__":
    # Support both CLI argument and JSON stdin
    if len(sys.argv) > 1:
        # CLI argument: python getTime.py Asia/Tokyo
        timezone = sys.argv[1]
    else:
        # JSON stdin or default to Tokyo
        try:
            input_data = json.load(sys.stdin)
            timezone = input_data.get("timezone", "Asia/Tokyo")
        except:
            timezone = "Asia/Tokyo"
    
    result = get_time(timezone)
    print(json.dumps(result, indent=2))