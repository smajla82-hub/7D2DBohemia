#!/bin/bash
while true; do
    echo "Starting 7 Days to Die server..."
    /home/steam/start_7d2d.sh
    echo "Server crashed with exit code $?. Respawning in 10 seconds..."
    sleep 10
done
