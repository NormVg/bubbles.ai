#!/bin/bash
echo "Starting Discord Bot Auto-Restarter..."

# Loop indefinitely to keep the bot alive
while true; do
    echo "[$(date)] Starting bot process..."
    LOG_LEVEL=debug node index.js
    EXIT_CODE=$?

    echo "[$(date)] Bot process exited with code $EXIT_CODE"

    # Optional: If you want to stop the loop on certain codes, check EXIT_CODE here.
    # Otherwise, it will just restart.

    echo "Restarting in 3 seconds..."
    sleep 3
done
