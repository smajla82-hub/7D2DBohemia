#!/bin/bash

echo "========================================"
echo "Starting 7D2D Server and All Services"
echo "========================================"

# Start 7D2D server (will do nothing if already running)
/home/steam/7D2DBohemia/server-scripts/lifecycle/telnet_restart_7d2d.sh start

# Wait for server to be fully up
echo "Waiting 45 seconds for server to initialize..."
sleep 45

# Start all PM2 services from ecosystem config
pm2 start /home/steam/7D2DBohemia/server-scripts/ecosystem.config.js

# Save PM2 process list for autostart
pm2 save

# Set up PM2 to start on system boot (only needs to be done once)
pm2 startup systemd --silent
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u steam --hp /home/steam

# Print status
pm2 list

echo "========================================"
echo "Startup Complete"
echo "========================================"
