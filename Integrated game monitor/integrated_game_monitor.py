#!/usr/bin/env python3
"""
integrated_game_monitor.py - Final version with all fixes
Features:
- Catchup system for level 1 players (with telnet warmup fix)
- Vote completion tracking with Takaro quest updates
- Level up detection with multiple pattern matching
- Automatic player level tracking
- Real-time Takaro quest integration via Node.js server
"""

import telnetlib
import time
import threading
import re
import os
import json
import logging
import requests
from datetime import datetime
from collections import defaultdict

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.expanduser('~/integrated_monitor.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ===================== CONFIGURATION =====================

# Server Configuration
HOST = '91.99.236.133'
PORT = 8081
PASSWORD = 'ferPa932'

# Takaro Configuration
TAKARO_GAME_SERVER_ID = "d7524118-c464-4ad9-91a0-57da9b4ad269"
TAKARO_MODULE_ID = "ddbe24ed-58ae-4f53-899c-9a99f8029135"
TAKARO_DOMAIN_ID = "32317e68-1311-4532-890f-987a311da3e3"

# Catchup Configuration Matrix
CATCHUP_MATRIX = [
    {"min": 100, "max": 150, "target": 60},
    {"min": 151, "max": 200, "target": 80},
    {"min": 201, "max": 250, "target": 120},
    {"min": 251, "max": 300, "target": 180},
    {"min": 301, "max": 350, "target": 240},
    {"min": 351, "max": 400, "target": 280},
    {"min": 401, "max": 450, "target": 320}
]

# Files
LEVELS_FILE = os.path.expanduser('~/players_levels.json')

# ===================== TAKARO QUEST INTEGRATION =====================

class TakaroQuestIntegration:
    """Handles communication with the Node.js Takaro quest server"""
    
    def __init__(self, quest_server_url="http://localhost:3000"):
        self.quest_server_url = quest_server_url
        self.session = requests.Session()
        self.session.timeout = 10
        
    def check_server_health(self):
        """Check if the quest server is running and authenticated"""
        try:
            response = self.session.get(f"{self.quest_server_url}/health")
            if response.status_code == 200:
                data = response.json()
                logger.info(f"Quest server: {data['status']}, authenticated: {data['authenticated']}")
                return data['authenticated']
            return False
        except Exception as e:
            logger.error(f"Quest server health check failed: {e}")
            return False
    
    def update_quest(self, player_name, quest_type, increment=1):
        """Update a player's quest progress"""
        try:
            payload = {
                "playerName": player_name,
                "questType": quest_type,
                "increment": increment
            }
            
            logger.debug(f"Sending quest update: {payload}")
            response = self.session.post(
                f"{self.quest_server_url}/update-quest",
                json=payload
            )
            
            if response.status_code == 200:
                data = response.json()
                if data['success']:
                    quest_data = data.get('questData', {})
                    progress = quest_data.get('progress', 0)
                    target = quest_data.get('target', 0)
                    logger.info(f"✅ Quest update successful for {player_name}: {progress}/{target}")
                    return True
                else:
                    logger.error(f"❌ Quest update failed: {data.get('error', 'Unknown error')}")
                    return False
            else:
                logger.error(f"❌ Quest server returned status {response.status_code}")
                return False
                
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Network error updating quest: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error updating quest: {e}")
            return False

# ===================== MAIN MONITOR CLASS =====================

class IntegratedMonitor:
    """Combined telnet monitor with catchup system and Takaro quest integration"""
    
    def __init__(self, host, port, password):
        self.host = host
        self.port = port
        self.password = password
        self.tn = None
        
        # Player level tracking
        self.players_levels = self.load_player_levels()
        
        # Connection management
        self.reconnect_delay = 30
        self.max_reconnect_delay = 480
        self.last_listplayers = 0
        self.command_delay = 0.5
        
        # Takaro quest integration
        self.quest_integration = TakaroQuestIntegration()
        self.quest_server_healthy = False
        
    def load_player_levels(self):
        """Load player levels from file"""
        if os.path.exists(LEVELS_FILE):
            try:
                with open(LEVELS_FILE, 'r') as f:
                    data = json.load(f)
                    logger.info(f"Loaded {len(data)} player levels from file")
                    return data
            except Exception as e:
                logger.error(f"Error loading levels file: {e}")
                return {}
        return {}
    
    def save_player_levels(self):
        """Save player levels to file"""
        try:
            with open(LEVELS_FILE, 'w') as f:
                json.dump(self.players_levels, f, indent=2)
            logger.debug(f"Saved {len(self.players_levels)} player levels to file")
        except Exception as e:
            logger.error(f"Error saving levels file: {e}")
    
    def connect(self):
        """Establish telnet connection with quest server check"""
        try:
            logger.info(f"Connecting to {self.host}:{self.port}")
            self.tn = telnetlib.Telnet(self.host, self.port, timeout=10)
            
            # Wait for password prompt
            self.tn.read_until(b"Please enter password:", timeout=5)
            self.tn.write(self.password.encode() + b"\n")
            time.sleep(1)
            
            # Clear initial buffer
            self.tn.read_very_eager()
            
            # Warm up the connection with a simple command
            logger.debug("Warming up telnet connection...")
            self.tn.write(b"version\n")
            time.sleep(0.5)
            self.tn.read_very_eager()
            
            logger.info("✅ Successfully connected to telnet")
            self.reconnect_delay = 30
            
            # Do initial player scan
            self.update_player_levels()
            
            # Check quest server health
            logger.info("Checking Takaro quest server...")
            self.quest_server_healthy = self.quest_integration.check_server_health()
            if self.quest_server_healthy:
                logger.info("✅ Quest server is healthy and authenticated")
            else:
                logger.warning("⚠️ Quest server is not available - quest updates will be disabled")
                logger.warning("   Make sure 'node working_server.js' is running")
            
            return True
            
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            return False
    
    def send_command(self, command):
        """Send command via telnet with proper delay"""
        try:
            logger.debug(f"Sending command: {command}")
            self.tn.write(f"{command}\n".encode())
            time.sleep(self.command_delay)
            
            # Read response to clear buffer
            self.tn.read_very_eager()
            return True
        except Exception as e:
            logger.error(f"Error sending command: {e}")
            return False
    
    def send_pm(self, player_name, message):
        """Send private message to player with retry"""
        for attempt in range(2):
            if self.send_command(f'pm {player_name} "{message}"'):
                logger.debug(f"PM sent to {player_name} (attempt {attempt + 1})")
                return True
            time.sleep(1)
        return False
    
    def update_player_levels(self):
        """Update player levels using listplayers command"""
        try:
            logger.info("Updating player levels...")
            
            # Clear buffer first
            self.tn.read_very_eager()
            
            # Send listplayers command
            self.tn.write(b"listplayers\n")
            time.sleep(1)
            
            # Read response
            response = self.tn.read_very_eager().decode('utf-8', errors='ignore')
            logger.debug(f"Listplayers response length: {len(response)}")
            
            # Parse player data
            pattern = r'id=(\d+),\s*([^,]+),.*?level=(\d+)'
            matches = re.findall(pattern, response)
            
            for match in matches:
                entity_id = match[0]
                player_name = match[1].strip()
                level = int(match[2])
                
                old_level = self.players_levels.get(player_name, 0)
                self.players_levels[player_name] = level
                
                if old_level != level:
                    logger.info(f"Updated {player_name} level: {old_level} -> {level}")
            
            self.save_player_levels()
            self.last_listplayers = time.time()
            
            logger.info(f"Player levels updated. Total players tracked: {len(self.players_levels)}")
            
        except Exception as e:
            logger.error(f"Error updating player levels: {e}")
    
    def get_player_level(self, player_name):
        """Get player level from stored data"""
        return self.players_levels.get(player_name, 1)
    
    def get_highest_level(self):
        """Get highest level player"""
        if not self.players_levels:
            logger.warning("No player levels stored")
            return 1
        highest = max(self.players_levels.values())
        logger.debug(f"Highest player level: {highest}")
        return highest
    
    def xp_for_level(self, level):
        """Calculate XP needed for level"""
        if level <= 60:
            return 3702082
        else:
            return 3702082 + (level - 60) * 186791
    
    def target_level_from_highest(self, highest):
        """Get target level based on highest"""
        for entry in CATCHUP_MATRIX:
            if entry["min"] <= highest <= entry["max"]:
                return entry["target"]
        return None
    
    def handle_catchup_command(self, player_name, steam_id=None):
        """Handle /catchup command"""
        player_level = self.get_player_level(player_name)
        logger.info(f"Processing /catchup for {player_name} (level {player_level})")
        
        if player_level > 1:
            self.send_pm(player_name, "You cannot use /catchup because you are above level 1.")
            return
        
        highest = self.get_highest_level()
        logger.info(f"Highest server level: {highest}")
        
        target_level = self.target_level_from_highest(highest)
        
        if not target_level:
            self.send_pm(player_name, "Catchup not available yet. Server highest level too low.")
            return
        
        xp = self.xp_for_level(target_level)
        self.send_command(f'givexp {player_name} {xp}')
        self.send_pm(player_name, f"Catchup applied! You are now level {target_level}.")
        
        # Update stored level
        self.players_levels[player_name] = target_level
        self.save_player_levels()
    
    def check_for_level_changes(self):
        """Check for level changes after XP message"""
        try:
            # Store current levels
            old_levels = self.players_levels.copy()
            
            # Update levels
            self.update_player_levels()
            
            # Check for changes
            for player_name, new_level in self.players_levels.items():
                old_level = old_levels.get(player_name, 1)
                if new_level > old_level:
                    logger.info(f"Detected level change: {player_name} {old_level} -> {new_level}")
                    self.handle_level_up(player_name, "unknown", new_level)
                    break  # Usually only one player levels up at a time
                    
        except Exception as e:
            logger.error(f"Error checking level changes: {e}")
    
    def handle_vote_completion(self, player_name):
        """Enhanced vote completion handler with Takaro integration"""
        logger.info(f"🗳️ Vote completion detected for {player_name}")
        
        # Send immediate feedback via telnet
        self.send_pm(player_name, "Vote detected! Updating daily quest...")
        
        # Update Takaro quest if server is available
        if self.quest_server_healthy:
            success = self.quest_integration.update_quest(player_name, "vote", 1)
            if success:
                # The Node.js server already sent the quest progress message
                logger.info(f"✅ Vote quest updated successfully for {player_name}")
            else:
                self.send_pm(player_name, "Vote registered, but quest update failed")
                logger.error(f"❌ Failed to update vote quest for {player_name}")
        else:
            self.send_pm(player_name, "Vote registered (Quest system offline)")
            logger.warning("Quest server not available for vote update")
    
    def handle_level_up(self, player_name, steam_id, new_level):
        """Enhanced level up handler with Takaro integration"""
        logger.info(f"📈 Level up detected: {player_name} reached level {new_level}")
        
        # Update stored level
        old_level = self.players_levels.get(player_name, 1)
        self.players_levels[player_name] = new_level
        self.save_player_levels()
        
        # Send immediate feedback
        self.send_pm(player_name, f"Level {new_level} achieved! Updating quest...")
        
        # Update Takaro quest if server is available
        if self.quest_server_healthy:
            success = self.quest_integration.update_quest(player_name, "levelup", 1)
            if success:
                logger.info(f"✅ Level quest updated successfully for {player_name}")
            else:
                self.send_pm(player_name, "Level registered, but quest update failed")
                logger.error(f"❌ Failed to update level quest for {player_name}")
        else:
            self.send_pm(player_name, "Level registered (Quest system offline)")
            logger.warning("Quest server not available for level update")
    
    def periodic_updates(self):
        """Thread for periodic tasks"""
        while self.tn:
            try:
                # Update player levels every hour
                if time.time() - self.last_listplayers > 3600:
                    self.update_player_levels()
                
                time.sleep(60)
                
            except Exception as e:
                logger.error(f"Periodic update error: {e}")
    
    def periodic_quest_health_check(self):
        """Periodically check quest server health"""
        while self.tn:
            try:
                # Check every 5 minutes
                time.sleep(300)
                
                old_health = self.quest_server_healthy
                self.quest_server_healthy = self.quest_integration.check_server_health()
                
                if old_health != self.quest_server_healthy:
                    if self.quest_server_healthy:
                        logger.info("✅ Quest server connection restored")
                    else:
                        logger.warning("⚠️ Quest server connection lost")
                        
            except Exception as e:
                logger.error(f"Health check error: {e}")
    
    def monitor_chat(self):
        """Enhanced monitor with Takaro quest integration"""
        logger.info("Starting enhanced chat monitor with Takaro quest integration")
        
        # Start periodic updates thread
        update_thread = threading.Thread(target=self.periodic_updates, daemon=True)
        update_thread.start()
        
        # Start quest health check thread
        health_thread = threading.Thread(target=self.periodic_quest_health_check, daemon=True)
        health_thread.start()
        
        while self.tn:
            try:
                line = self.tn.read_until(b"\n", timeout=1)
                
                if not line:
                    continue
                
                line_str = line.decode('utf-8', errors='ignore').strip()
                
                if not line_str:
                    continue
                
                # Debug log specific events
                if any(keyword in line_str for keyword in ["Chat", "level", "catchup", "vote", "Thanks", "XP gained"]):
                    logger.debug(f"Received: {line_str}")
                
                # Check for /catchup command
                catchup_match = re.search(r"Chat \(from 'Steam_(\d+)', entity id '(\d+)', to 'Global'\): '(.+?)':/catchup", line_str)
                if catchup_match:
                    steam_id = catchup_match.group(1)
                    player_name = catchup_match.group(3)
                    logger.info(f"Detected /catchup from {player_name}")
                    time.sleep(0.2)
                    self.handle_catchup_command(player_name, steam_id)
                
                # Check for vote completion
                if "Thanks for voting" in line_str and "Your rewards have been automatically delivered" in line_str:
                    match = re.search(r"Thanks for voting (.+?)!", line_str)
                    if match:
                        player_name = match.group(1)
                        self.handle_vote_completion(player_name)
                
                # Check for level up - Multiple patterns
                if "[CSMM_Patrons]playerLeveled:" in line_str:
                    match = re.search(r"playerLeveled: (.+?) \(Steam_(\d+)\) made level (\d+)", line_str)
                    if match:
                        player_name = match.group(1)
                        steam_id = match.group(2)
                        new_level = int(match.group(3))
                        self.handle_level_up(player_name, steam_id, new_level)
                
                # Alternative level up pattern
                elif "XP gained during the last level:" in line_str:
                    # This log appears right after level up, check recent listplayers to see who leveled
                    logger.info("XP level message detected - checking for level changes...")
                    time.sleep(0.5)  # Small delay
                    self.check_for_level_changes()
                    
            except Exception as e:
                if "connection closed" in str(e).lower():
                    logger.warning("Connection lost")
                    break
                else:
                    logger.error(f"Monitor error: {e}")
                    continue
    
    def run(self):
        """Main run loop"""
        while True:
            try:
                if not self.connect():
                    logger.info(f"Waiting {self.reconnect_delay} seconds before retry...")
                    time.sleep(self.reconnect_delay)
                    self.reconnect_delay = min(self.reconnect_delay * 2, self.max_reconnect_delay)
                    continue
                
                self.monitor_chat()
                
            except KeyboardInterrupt:
                logger.info("Shutting down...")
                break
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                time.sleep(self.reconnect_delay)
                self.reconnect_delay = min(self.reconnect_delay * 2, self.max_reconnect_delay)
        
        if self.tn:
            self.tn.close()

# ===================== MAIN ENTRY POINT =====================

def main():
    logger.info("Integrated Game Monitor Starting")
    logger.info("=" * 50)
    logger.info("Features:")
    logger.info("- Catchup system for level 1 players (with telnet warmup)")
    logger.info("- Vote completion tracking → Takaro quest updates")
    logger.info("- Level up detection (multiple patterns) → Takaro quest updates") 
    logger.info("- Automatic player level tracking")
    logger.info("- Real-time Takaro quest integration")
    logger.info("")
    logger.info("🚀 IMPORTANT: Make sure 'node working_server.js' is running for quest updates!")
    logger.info("   Run it in the takaro-quest-integration directory")
    logger.info("")
    
    monitor = IntegratedMonitor(HOST, PORT, PASSWORD)
    monitor.run()

if __name__ == "__main__":
    main()
