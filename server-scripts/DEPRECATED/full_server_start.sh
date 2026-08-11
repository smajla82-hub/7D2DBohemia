#!/bin/bash
# Enhanced 7D2D Server, Catchup System, and Voting System Starter

echo "========================================"
echo "Starting 7D2D Server, Catchup, and Voting Systems"
echo "========================================"

# Start 7D2D server
echo "[1/6] Starting 7D2D server..."
~/telnet_restart_7d2d.sh start

# Wait for server to fully start
echo "[2/6] Waiting for server to initialize (45 seconds)..."
sleep 45

# Kill any existing catchup system
echo "[3/6] Stopping any existing catchup system..."
pkill -f integrated_game_monitor.py
sleep 2

# Start new catchup system
echo "[4/6] Starting game monitor system..."
cd ~
nohup python3 integrated_game_monitor.py > integrated_game_monitor.log 2>&1 &
CATCHUP_PID=$!

# Kill any existing voting system
echo "[5/6] Stopping any existing voting system..."
pkill -f voting_rewards.py
sleep 2

# Start new voting system
echo "[6/6] Starting voting rewards system..."
cd ~
nohup python3 voting_rewards.py > voting_rewards.log 2>&1 &
VOTING_PID=$!

# Wait a moment to check if it started successfully
sleep 3

# Status checks
echo ""
echo "========================================"
echo "Status Check:"
echo "========================================"

# Check Catchup system
if pgrep -f "integrated_game_monitor.py" > /dev/null; then
    echo "? Game Monitor: RUNNING"
else
    echo "? Game Monitor: NOT RUNNING"
fi

# Check 7D2D server
if pgrep -f "7DaysToDieServer" > /dev/null; then
    echo "? 7D2D Server: RUNNING"
else
    echo "? 7D2D Server: NOT RUNNING"
fi

# Check Voting system
if pgrep -f "voting_rewards.py" > /dev/null; then
    echo "? Voting Rewards System: RUNNING"
else
    echo "? Voting Rewards System: NOT RUNNING"
fi

echo "========================================"
echo "Startup Complete"
echo "========================================"
