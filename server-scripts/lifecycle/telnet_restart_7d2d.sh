#!/bin/bash

SERVER_DIR="/home/steam/7d2d-server"
CONFIG_FILE="serverconfig.xml"
LOG_DIR="/home/steam/logs"
RESTART_LOG="/home/steam/restart.log"
PID_FILE="/home/steam/7d2d.pid"
TELNET_PASSWORD="ferPa932"  # Match your serverconfig.xml telnet password
LOG_RETENTION_DAYS=30

# Prevent two concurrent invocations of this script (e.g. a cron-triggered restart
# and a simultaneous manual restart by an admin) from racing each other. Running two
# instances at the same time causes both to independently call shutdown_server() and
# start_server(), producing interleaved restart countdowns and corrupted server state.
LOCK_FILE="/home/steam/7D2DBohemia/server-scripts/lifecycle/.telnet_restart.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "$(date '+%Y-%m-%d %H:%M:%S'): Aborted: another instance of telnet_restart_7d2d.sh is already running (PID held the lock)" >> "$RESTART_LOG"
    echo "Another instance of telnet_restart_7d2d.sh is already running. Exiting."
    exit 1
fi

log_restart() {
    local message=$1
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $message" >> "$RESTART_LOG"
}

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
    log_restart "Sent message: $message"
}

apply_prismacore_settings() {
    # Hide PrismaCore/CSMM chat command prefixes (/ and $) from global chat.
    # This setting is NOT persisted by PrismaCore across server restarts, so it
    # must be re-applied via telnet every time the server (re)starts.
    # Retry up to 3 times with a 5s delay between attempts, because PrismaCore
    # may not have fully initialized its custom commands (like hccp) yet even
    # though the base server process is already running.
    # Note: send_telnet_cmd discards all telnet output, so success cannot be
    # detected programmatically — all attempts are always sent.
    local max_attempts=3
    local attempt
    for attempt in $(seq 1 $max_attempts); do
        log_restart "Applying PrismaCore hccp /,\$ (attempt $attempt/$max_attempts)..."
        send_telnet_cmd "hccp /,\$"
        if [ "$attempt" -lt "$max_attempts" ]; then
            sleep 5
        fi
    done
    log_restart "Applied PrismaCore hccp /,\$ (hide chat command prefixes) — $max_attempts attempt(s) sent"
}

is_server_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

cleanup_old_logs() {
    mkdir -p "$LOG_DIR"
    find "$LOG_DIR" -name "server_*.log" -type f -mtime +"$LOG_RETENTION_DAYS" -exec rm -f {} \;
    log_restart "Cleaned up logs older than $LOG_RETENTION_DAYS days"
}

start_server() {
    if is_server_running; then
        log_restart "Start aborted: server already running (PID: $(cat "$PID_FILE"))"
        echo "Server is already running (PID: $(cat "$PID_FILE"))"
        return 1
    fi

    mkdir -p "$LOG_DIR"
    cleanup_old_logs

    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local log_file="$LOG_DIR/server_$timestamp.log"
    local latest_link="$LOG_DIR/latest.log"

    log_restart "Starting server... Log file: $log_file"

    cd "$SERVER_DIR" || {
        log_restart "ERROR: Failed to cd into $SERVER_DIR"
        return 1
    }

    # Close FD 200 in the background child so it cannot inherit and hold the
    # flock lock for hours, which would block all future restart invocations.
    nohup ./7DaysToDieServer.x86_64 -configfile="$CONFIG_FILE" -quit -batchmode -nographics -dedicated \
        200>&- > "$log_file" 2>&1 &

    local pid=$!
    echo "$pid" > "$PID_FILE"

    ln -sf "$log_file" "$latest_link"

    log_restart "Server started with PID $pid. Log: $log_file (latest: $latest_link)"

    sleep 30

    if kill -0 "$pid" 2>/dev/null; then
        log_restart "Verified: server is running (PID: $pid)"
        echo "Server started successfully (PID: $pid). Log: $log_file"

        # Re-apply PrismaCore chat command prefix hiding on every start,
        # since it resets on each server restart.
        apply_prismacore_settings
    else
        log_restart "ERROR: Server failed to start or crashed shortly after launch (PID: $pid). Check log: $log_file"
        echo "ERROR: Server failed to start. Check log: $log_file"
        rm -f "$PID_FILE"
        return 1
    fi
}

shutdown_server() {
    if is_server_running; then
        local pid=$(cat "$PID_FILE")
        log_restart "Shutting down server (PID: $pid)"
        send_telnet_cmd "shutdown"
        sleep 15
        if kill -0 "$pid" 2>/dev/null; then
            kill -15 "$pid"
            sleep 10
            if kill -0 "$pid" 2>/dev/null; then
                log_restart "Server did not stop gracefully, sending SIGKILL (PID: $pid)"
                kill -9 "$pid"
            fi
        fi
        rm -f "$PID_FILE"
        log_restart "Server shutdown complete"
    else
        log_restart "Shutdown skipped: server not running"
        echo "Server is not running."
    fi
}

restart_with_countdown() {
    log_restart "Starting restart countdown"

    if ! is_server_running; then
        log_restart "Restart aborted: server not running, starting fresh instead"
        start_server
        return
    fi

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

    if is_server_running; then
        send_message "✅ Server restart complete! Welcome back, survivors!"
    else
        log_restart "WARNING: Server does not appear to be running after restart!"
    fi
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
