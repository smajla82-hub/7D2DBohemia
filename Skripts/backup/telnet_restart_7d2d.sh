#!/bin/bash

SERVER_DIR="/home/steam/7d2d-server"
CONFIG_FILE="serverconfig.xml"
LOG_FILE="/home/steam/restart.log"
PID_FILE="/home/steam/7d2d.pid"
TELNET_PASSWORD="ferPa932"  # Match your serverconfig.xml telnet password

send_telnet_cmd() {
    local cmd=$1
    {
        echo "$TELNET_PASSWORD"
        sleep 1
        echo "$cmd"
        sleep 1
        echo "exit"
    } | telnet localhost 8081 >/dev/null 2>&1
}

send_message() {
    local message=$1
    send_telnet_cmd "say \"[SERVER] $message\""
    echo "$(date): Sent message: $message" >> $LOG_FILE
}

start_server() {
    cd $SERVER_DIR
    echo "$(date): Starting server..." >> $LOG_FILE
    ./7DaysToDieServer.x86_64 -configfile=$CONFIG_FILE -quit -batchmode -nographics -dedicated &
    echo $! > $PID_FILE
    echo "$(date): Server started with PID $(cat $PID_FILE)" >> $LOG_FILE
    sleep 30
}

shutdown_server() {
    if [ -f $PID_FILE ]; then
        local pid=$(cat $PID_FILE)
        echo "$(date): Shutting down server (PID: $pid)" >> $LOG_FILE
        send_telnet_cmd "shutdown"
        sleep 15
        if kill -0 $pid 2>/dev/null; then
            kill -15 $pid
            sleep 10
            if kill -0 $pid 2>/dev/null; then
                kill -9 $pid
            fi
        fi
        rm -f $PID_FILE
        echo "$(date): Server shutdown complete" >> $LOG_FILE
    fi
}

restart_with_countdown() {
    echo "$(date): Starting restart countdown" >> $LOG_FILE
    send_message "🔄 SERVER RESTART in 5 minutes! Please find a safe location and prepare to logout."
    sleep 180
    send_message "⚠️ SERVER RESTART in 2 minutes! "
    sleep 60
    send_message "🚨 SERVER RESTART in 1 MINUTE! "
    sleep 45
    send_message "⏰ SERVER RESTART in 15 seconds! Saving world data..."
    send_telnet_cmd "saveworld"
    sleep 10
    for i in 5 4 3 2 1; do
        send_message "Restarting in $i..."
        sleep 1
    done
    send_message "🔄 Server restarting now! Please reconnect in 1 minute."
    shutdown_server
    sleep 15
    start_server
    sleep 70
    send_message "✅ Server restart complete! Welcome back, survivors!"
}

case "$1" in
    start)
        start_server
        ;;
    stop)
        shutdown_server
        ;;
    restart)
        restart_with_countdown
        ;;
    *)
        echo "Usage: $0 {start|stop|restart}"
        exit 1
        ;;
esac
