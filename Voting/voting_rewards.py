#!/usr/bin/env python3
"""
7D2D Voting Rewards Production Script with Automatic Detection
Version 31 - Fixed exponential backoff for reconnection spam
"""

import telnetlib
import time
import threading
import re
import os
import logging
import requests
import random
from datetime import datetime, timedelta, timezone
import pytz

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.expanduser('~/voting_rewards.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class VotingRewards:
    def __init__(self, host='localhost', port=8081, password='', api_key=''):
        # Server connection settings
        self.host = host
        self.port = port
        self.password = password
        self.api_key = api_key
        self.tn = None
        
        # API endpoints
        self.api_base = 'https://7daystodie-servers.com/api/'
        
        # Messages
        self.messages = {
            'THANK_YOU_MESSAGE': 'Thanks for voting {player_name}! Your rewards have been automatically delivered! Look, goodies are at your feet :D',
            'ALREADY_VOTED_MESSAGE': 'You already voted today and claimed your reward! You can vote again in approximately {hours}h {minutes}m.',
            'GLOBAL_REWARD_MESSAGE': '{player_name} just received his well deserved reward!',
            'VOTE_COMMAND_RESPONSE': 'Please vote on 7daystodie-servers.com (search Bohemia) or go to: https://7daystodie-servers.com/server/157783 - Your rewards will be dropped in front of you within 2 minutes after voting!',
            'GLOBAL_VOTE_MESSAGE': 'Vote for our server and get great rewards! Type /vote in chat!'
        }
        
        # Fixed rewards
        self.fixed_rewards = [
            ('drinkJarBoiledWater', 5),
            ('foodBaconAndEggs', 3),
            ('ammo762mmBulletBall', 100)
        ]
        
        # Crafting skill magazines - exact item names for give command
        self.skill_books = [
            'repairToolsSkillMagazine',      # Handy Land (Repair)
            'salvageToolsSkillMagazine',     # Scrapping 4 Fun (Salvage)
            'knucklesSkillMagazine',         # Furious Fists (Fist Combat)
            'bladesSkillMagazine',           # Knife Guy (Knives)
            'clubsSkillMagazine',            # Big Hutters (Clubs)
            'sledgehammersSkillMagazine',    # Get Hammered (Sledgehammers)
            'spearsSkillMagazine',           # Sharp Sticks (Spears)
            'bowsSkillMagazine',             # Bow Hunters (Bows)
            'handgunsSkillMagazine',         # Handgun Magazine (Pistols and SMG)
            'shotgunsSkillMagazine',         # Shotgun Weekly (Shotguns)
            'riflesSkillMagazine',           # Rifle World (Rifles)
            'machineGunsSkillMagazine',      # Tactical Warfare (Machine Guns)
            'explosivesSkillMagazine',       # Explosives Magazine (Explosives)
            'roboticsSkillMagazine',         # Tech Planet (Robotics and Batons)
            'armorSkillMagazine',            # Armored Up (Armor)
            'medicalSkillMagazine',          # Medical Journal (Medicine)
            'foodSkillMagazine',             # Home Cooking Weekly (Food Recipes)
            'seedSkillMagazine',             # Southern Farming (Farming and Seeds)
            'electricianSkillMagazine',      # Wiring 101 (Electronics)
            'trapsSkillMagazine',            # Electrical Traps (Traps)
            'workstationSkillMagazine',      # Forge Ahead (Workstations)
            'vehiclesSkillMagazine'          # Vehicle Adventures (Vehicles)
        ]
        
        # Tracking for one-time messages and automatic checking
        self.players_thanked = set()
        self.players_rewarded = set()
        self.players_to_check = {}  # {steam_id: (player_name, timestamp)}
        self.players_checked_today = set()  # Prevent spam for already claimed players
        self.last_vote_times = {}  # {steam_id: timestamp} - Track when players last voted
        self.players_pending_check = {}  # {steam_id: player_name} - Players who typed /vote before
        
        # Set timezone for daily reset
        self.cest_tz = pytz.timezone('Europe/Prague')  # CEST timezone
        
        # Reconnection backoff - START WITH 30 SECONDS
        self.reconnect_delay = 30  # Start with 30 seconds
        self.max_reconnect_delay = 480  # Max 8 minutes
    
    def connect(self):
        """Connect to the 7D2D telnet server"""
        try:
            logger.info(f"Connecting to {self.host}:{self.port}")
            self.tn = telnetlib.Telnet(self.host, self.port, timeout=10)
            
            # Wait for initial response
            time.sleep(0.5)
            initial_response = self.tn.read_very_eager().decode('utf-8', errors='ignore')
            logger.debug(f"Initial response: {initial_response}")
            
            # Send password if provided
            if self.password:
                logger.info("Sending password")
                self.tn.write(f"{self.password}\n".encode('utf-8'))
                time.sleep(1)
                auth_response = self.tn.read_very_eager().decode('utf-8', errors='ignore')
                logger.debug(f"Auth response: {auth_response}")
            
            # Test connection with a simple command
            self.tn.write(b"help\n")
            time.sleep(0.5)
            help_response = self.tn.read_very_eager().decode('utf-8', errors='ignore')
            logger.debug(f"Help command response: {help_response[:200]}")
            
            logger.info(f"Successfully connected to {self.host}:{self.port}")
            # Reset backoff on successful connection
            self.reconnect_delay = 30
            return True
            
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            return False
    
    def send_command(self, command, flush=True):
        """Send a command to the server"""
        if self.tn:
            try:
                # Clear any pending data before sending command
                try:
                    self.tn.read_very_eager()
                except:
                    pass
                
                logger.debug(f"Sending command: {command}")
                self.tn.write(f"{command}\n".encode('utf-8'))
                time.sleep(0.5)  # Give server time to process
                
                # Send a flush command to ensure the previous command is processed
                if flush and not command.startswith("version"):
                    logger.debug("Sending flush command")
                    self.tn.write(b"version\n")
                    time.sleep(0.2)
                    # Clear the version output
                    try:
                        self.tn.read_very_eager()
                    except:
                        pass
                
                return True
            except Exception as e:
                logger.error(f"Failed to send command: {e}")
                return False
        return False
    
    def send_private_message(self, player_name, message):
        """Send a private message to a specific player"""
        command = f'pm {player_name} "{message}"'
        logger.info(f"Sending PM to {player_name}: {message}")
        return self.send_command(command, flush=True)
    
    def send_global_message(self, message):
        """Send a global message to all players"""
        command = f'say "{message}"'
        logger.info(f"Sending global message: {message}")
        self.send_command(command, flush=True)
    
    def give_rewards(self, player_name):
        """Give rewards to the player"""
        logger.info(f"Giving rewards to {player_name}")
        
        # Give fixed rewards
        for item, amount in self.fixed_rewards:
            command = f'give {player_name} {item} {amount}'
            self.send_command(command)
            time.sleep(0.3)
        
        # Give 3 random skill books (no duplicates)
        random_books = random.sample(self.skill_books, 3)
        for book in random_books:
            command = f'give {player_name} {book} 1'
            self.send_command(command)
            time.sleep(0.3)
            
        logger.info(f"Gave {player_name}: Fixed rewards + books: {', '.join(random_books)}")
    
    def get_last_vote_time(self, steam_id):
        """Get the last vote time for a player from API"""
        try:
            # Get vote history in JSON format
            url = f"https://7daystodie-servers.com/api/?object=servers&element=votes&key={self.api_key}&format=json"
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                
                # Get votes array
                votes = data.get('votes', [])
                
                # Find the most recent vote for this player (claimed or unclaimed)
                # We need to check ALL votes, not just claimed ones
                latest_vote_time = None
                for vote in votes:
                    if vote.get('steamid') == steam_id:
                        # Use the UTC timestamp
                        utc_timestamp = vote.get('utc timestamp', vote.get('timestamp', 0))
                        if isinstance(utc_timestamp, str):
                            utc_timestamp = int(utc_timestamp)
                        else:
                            utc_timestamp = int(utc_timestamp)
                            
                        if utc_timestamp > 0:
                            # Create UTC datetime and convert to CEST
                            vote_time_utc = datetime.fromtimestamp(utc_timestamp, tz=timezone.utc)
                            vote_time = vote_time_utc.astimezone(self.cest_tz)
                            
                            # Take the most recent vote regardless of claimed status
                            if latest_vote_time is None or vote_time > latest_vote_time:
                                latest_vote_time = vote_time
                                logger.info(f"Found vote time for {steam_id}: {vote_time} (API says: {vote.get('date cest', 'unknown')}, claimed: {vote.get('claimed', 'unknown')})")
                
                if latest_vote_time:
                    self.last_vote_times[steam_id] = latest_vote_time
                    return latest_vote_time
                else:
                    logger.warning(f"No valid vote time found for {steam_id}")
            else:
                logger.error(f"API returned status code: {response.status_code}")
            return None
        except Exception as e:
            logger.error(f"Failed to get vote history: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None
    
    def get_daily_reset_time(self):
        """Get today's 6 AM CEST reset time"""
        now = datetime.now(self.cest_tz)
        reset_time = now.replace(hour=6, minute=0, second=0, microsecond=0)
        
        # If it's before 6 AM, use yesterday's reset
        if now.hour < 6:
            reset_time = reset_time - timedelta(days=1)
            
        return reset_time
    
    def has_voted_today(self, steam_id):
        """Check if player has voted after today's reset"""
        # First check if we have the vote time cached
        if steam_id not in self.last_vote_times:
            # Try to get it from API
            self.get_last_vote_time(steam_id)
            
        if steam_id not in self.last_vote_times:
            return False
            
        last_vote = self.last_vote_times[steam_id]
        reset_time = self.get_daily_reset_time()
        
        # Convert to timezone-aware for comparison if needed
        if last_vote.tzinfo is None:
            last_vote = self.cest_tz.localize(last_vote)
            
        return last_vote > reset_time
    
    def calculate_next_vote_time(self, last_vote_time):
        """Calculate when player can vote next"""
        if not last_vote_time:
            return None
            
        # Next vote is at 6 AM CEST the following day
        next_vote = last_vote_time.replace(hour=6, minute=0, second=0, microsecond=0)
        if last_vote_time.hour >= 6:
            next_vote = next_vote + timedelta(days=1)
            
        return next_vote
    
    def get_time_until_next_vote(self, steam_id):
        """Get formatted time until player can vote again"""
        last_vote = self.last_vote_times.get(steam_id)
        if not last_vote:
            last_vote = self.get_last_vote_time(steam_id)
            
        if not last_vote:
            return "unknown"
            
        next_vote = self.calculate_next_vote_time(last_vote)
        now = datetime.now(self.cest_tz)
        
        if next_vote <= now:
            return "0h 0m"
            
        time_diff = next_vote - now
        hours = int(time_diff.total_seconds() // 3600)
        minutes = int((time_diff.total_seconds() % 3600) // 60)
        
        return f"{hours}h {minutes}m"
    
    def check_vote_status(self, steam_id):
        """Check vote status from API with daily reset handling
        Returns: 0 (not found), 1 (voted not claimed), 2 (voted and claimed)
        """
        try:
            # API endpoint to check vote status
            url = f"https://7daystodie-servers.com/api/?object=votes&element=claim&key={self.api_key}&steamid={steam_id}"
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                result = int(response.text.strip())
                logger.info(f"Vote status for {steam_id}: {result}")
                
                # If status is 2 (claimed), check if it's from before today's reset
                if result == 2:
                    if not self.has_voted_today(steam_id):
                        logger.info(f"Vote status is 2 but from before daily reset - treating as 0")
                        return 0
                
                return result
            else:
                logger.error(f"API error checking vote: {response.status_code}")
                return 0
        except Exception as e:
            logger.error(f"Error in check_vote_status: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return 0
    
    def set_vote_claimed(self, steam_id):
        """Set vote as claimed via API"""
        try:
            # API endpoint to set vote as claimed
            url = f"https://7daystodie-servers.com/api/?action=post&object=votes&element=claim&key={self.api_key}&steamid={steam_id}"
            response = requests.post(url, timeout=5)
            
            if response.status_code == 200:
                result = int(response.text.strip())
                if result == 1:
                    logger.info(f"Successfully claimed vote for {steam_id}")
                    return True
                else:
                    logger.warning(f"Vote was not claimed for {steam_id}: {result}")
                    return False
            else:
                logger.error(f"API error claiming vote: {response.status_code}")
                return False
        except Exception as e:
            logger.error(f"API request failed: {e}")
            return False
    
    def handle_vote_command(self, player_name, steam_id):
        """Handle when a player types /vote"""
        logger.info(f"Handling /vote command from {player_name} (Steam ID: {steam_id})")
        
        # Add a small delay to ensure server is ready
        time.sleep(0.3)
        
        # FIRST check vote status
        vote_status = self.check_vote_status(steam_id)
        
        if vote_status == 0:
            # Not voted yet - send vote command response and add to check list
            logger.info(f"{player_name} has not voted yet")
            self.send_private_message(player_name, self.messages['VOTE_COMMAND_RESPONSE'])
            
            # Add to automatic check list
            self.players_to_check[steam_id] = (player_name, datetime.now())
            self.players_pending_check[steam_id] = player_name  # Remember they typed /vote
            logger.info(f"Added {player_name} to automatic check list")
            
        elif vote_status == 1:
            # Voted but not claimed - give rewards immediately
            logger.info(f"{player_name} has voted but not claimed - giving rewards")
            self.process_reward(player_name, steam_id)
                
        elif vote_status == 2:
            # Already voted and claimed
            logger.info(f"{player_name} has already voted and claimed")
            # Get time until next vote
            time_until = self.get_time_until_next_vote(steam_id)
            hours, minutes = 0, 0
            if 'h' in time_until:
                parts = time_until.split('h')
                hours = int(parts[0])
                minutes = int(parts[1].replace('m', '').strip())
            
            message = self.messages['ALREADY_VOTED_MESSAGE'].format(hours=hours, minutes=minutes)
            self.send_private_message(player_name, message)
    
    def process_reward(self, player_name, steam_id):
        """Process reward for a player who has voted"""
        self.give_rewards(player_name)
        
        # Claim the vote
        if self.set_vote_claimed(steam_id):
            # Update last vote time to NOW since they just voted
            self.last_vote_times[steam_id] = datetime.now(self.cest_tz)
            logger.info(f"Updated vote time for {steam_id} to current time")
            
            # Small delay between messages
            time.sleep(0.5)
            
            # Send thank you message (only once)
            if steam_id not in self.players_thanked:
                self.send_private_message(player_name, self.messages['THANK_YOU_MESSAGE'].format(player_name=player_name))
                self.players_thanked.add(steam_id)
                time.sleep(0.5)  # Delay before global message
            
            # Send global reward message (only once)
            if steam_id not in self.players_rewarded:
                self.send_global_message(self.messages['GLOBAL_REWARD_MESSAGE'].format(player_name=player_name))
                self.players_rewarded.add(steam_id)
            
            # Add to checked today to prevent spam
            self.players_checked_today.add(steam_id)
        else:
            logger.error(f"Failed to claim vote for {player_name}")
    
    def automatic_vote_checker(self):
        """Check players who typed /vote for completed votes"""
        logger.info("Starting automatic vote checker thread")
        
        while True:
            try:
                # Clean up old entries (older than 10 minutes)
                current_time = datetime.now()
                to_remove = []
                
                for steam_id, (player_name, timestamp) in self.players_to_check.items():
                    if current_time - timestamp > timedelta(minutes=10):
                        to_remove.append(steam_id)
                        logger.info(f"Removing {player_name} from check list (timeout)")
                
                for steam_id in to_remove:
                    del self.players_to_check[steam_id]
                
                # Check remaining players
                for steam_id, (player_name, timestamp) in list(self.players_to_check.items()):
                    vote_status = self.check_vote_status(steam_id)
                    
                    if vote_status == 1:
                        # Player has voted! Give rewards
                        logger.info(f"Automatic check: {player_name} has voted! Delivering rewards...")
                        self.process_reward(player_name, steam_id)
                        # Remove from check list
                        del self.players_to_check[steam_id]
                    elif vote_status == 2:
                        # Already claimed (maybe through another method)
                        logger.info(f"Automatic check: {player_name} already claimed")
                        del self.players_to_check[steam_id]
                        self.players_checked_today.add(steam_id)
                
                # Wait 30 seconds before next check
                time.sleep(30)
                
            except Exception as e:
                logger.error(f"Error in automatic checker: {e}")
                time.sleep(30)
    
    def monitor_chat(self):
        """Monitor telnet output for chat commands"""
        if not self.tn:
            return
        
        logger.info("Starting chat monitoring for /vote commands...")
        buffer = ""
        
        while True:
            try:
                # Read available data
                data = self.tn.read_very_eager()
                if data:
                    text = data.decode('utf-8', errors='ignore')
                    buffer += text
                    
                    # Process complete lines
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        
                        if line:
                            logger.debug(f"Telnet output: {line}")
                            
                            # Track player joins to warm up connection
                            if "PlayerSpawnedInWorld" in line:
                                player_match = re.search(r"PlayerName='([^']+)'", line)
                                steam_match = re.search(r"PltfmId='Steam_(\d+)'", line)
                                
                                if player_match and steam_match:
                                    player_name = player_match.group(1)
                                    steam_id = steam_match.group(1)
                                    
                                    logger.info(f"Player {player_name} spawned, warming up connection")
                                    time.sleep(2)
                                    self.send_command("help")
                                    logger.info("Connection warmed up")
                                    
                                    # Check if this player had typed /vote before
                                    if steam_id in self.players_pending_check:
                                        logger.info(f"Re-adding {player_name} to vote check list (returning player)")
                                        self.players_to_check[steam_id] = (player_name, datetime.now())
                                        # Don't remove from pending - they might disconnect again
                            
                            # Look for chat messages with /vote command
                            patterns = [
                                r"Chat \(from '([^']+)', entity id '(\d+)', to '[^']+'\): ([^\n]+)",
                                r"Chat: '([^']+)': ([^\n]+)",
                                r"\[CHAT\] ([^:]+): ([^\n]+)",
                                r"(\w+): (/vote)",
                            ]
                            
                            for pattern in patterns:
                                match = re.search(pattern, line)
                                if match:
                                    if len(match.groups()) >= 3:
                                        platform_id = match.group(1)
                                        entity_id = match.group(2)
                                        message = match.group(3).strip()
                                    else:
                                        platform_id = match.group(1)
                                        message = match.group(2) if len(match.groups()) > 1 else match.group(1)
                                        entity_id = None
                                    
                                    logger.debug(f"Chat match: platform_id={platform_id}, message={message}")
                                    
                                    if '/vote' in message.lower():
                                        # Extract steam ID
                                        steam_id = None
                                        if 'Steam_' in platform_id:
                                            steam_id = platform_id.replace('Steam_', '')
                                        
                                        if steam_id:
                                            # Try to get player name from the line
                                            name_match = re.search(r"'([^']+)': /vote", line)
                                            player_name = name_match.group(1) if name_match else f"Player_{entity_id}"
                                            
                                            logger.info(f"Vote command detected from {player_name} (Steam ID: {steam_id})")
                                            
                                            # Clear buffer before handling command
                                            try:
                                                self.tn.read_very_eager()
                                            except:
                                                pass
                                            
                                            self.handle_vote_command(player_name, steam_id)
                                        break
                
                # Small delay to prevent CPU spinning
                time.sleep(0.1)
                    
            except (EOFError, ConnectionError, AttributeError) as e:
                # Connection lost - this is THE FIX for the log spam
                logger.error(f"Monitor error: {e}")
                # CRITICAL: Wait before breaking out
                logger.info(f"Waiting {self.reconnect_delay} seconds before reconnection attempt...")
                time.sleep(self.reconnect_delay)
                # Double the delay for next time
                self.reconnect_delay = min(self.reconnect_delay * 2, self.max_reconnect_delay)
                break
            except Exception as e:
                logger.error(f"Monitor error: {e}")
                break
    
    def send_periodic_message(self):
        """Send global vote message every 60 minutes"""
        logger.info("Starting periodic message thread (60 minute interval)")
        while True:
            time.sleep(3600)  # 60 minutes
            
            # Check if connected before sending
            if self.tn:
                try:
                    self.send_global_message(self.messages['GLOBAL_VOTE_MESSAGE'])
                    logger.info("Sent periodic vote message")
                except Exception as e:
                    logger.warning(f"Failed to send periodic message: {e}")
            else:
                logger.debug("Skipping periodic message - not connected")
            
            # Clear tracking lists at daily reset (6 AM CEST)
            now = datetime.now(self.cest_tz)
            if now.hour == 6 and now.minute < 1:
                self.players_checked_today.clear()
                self.players_thanked.clear()
                self.players_rewarded.clear()
                logger.info("Daily reset at 6 AM CEST - cleared tracking lists")
    
    def run(self):
        """Main run method - returns True if should retry, False if shutting down"""
        if not self.connect():
            return True  # Connection failed, should retry
        
        # Start periodic message thread
        periodic_thread = threading.Thread(target=self.send_periodic_message, daemon=True)
        periodic_thread.start()
        
        # Start automatic vote checker thread
        checker_thread = threading.Thread(target=self.automatic_vote_checker, daemon=True)
        checker_thread.start()
        
        # Start monitoring chat
        try:
            self.monitor_chat()
            return True  # Monitor exited, should retry
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            return False  # User requested shutdown
        finally:
            if self.tn:
                self.tn.close()

def main():
    """Main function with automatic setup"""
    logger.info("7D2D Voting Rewards System with Auto-Detection Starting")
    logger.info("=================================================")
    
    # Check if pytz is installed
    try:
        import pytz
    except ImportError:
        logger.error("pytz module not found. Installing...")
        os.system("pip3 install --user pytz")
        logger.info("Please restart the script after pytz installation")
        return
    
    # Configuration
    host = '91.99.236.133'
    port = 8081
    password = 'ferPa932'
    api_key = 'nev0DEqwzjXzQC1TO7azAqdMNmGGC9vNMZO'
    
    logger.info(f"Connecting to {host}:{port}")
    logger.info(f"Server ID: 157783")
    logger.info("Auto-detection enabled: Players will receive rewards automatically after voting")
    logger.info("Daily reset time: 6:00 AM CEST")
    
    # Track reconnection delay globally
    global_reconnect_delay = 30
    max_reconnect_delay = 480
    
    # Run with automatic reconnection
    while True:
        try:
            voting_system = VotingRewards(host, port, password, api_key)
            # Copy the global delay to the instance
            voting_system.reconnect_delay = global_reconnect_delay
            
            should_retry = voting_system.run()
            
            if not should_retry:
                # User requested shutdown
                break
            
            # If run() exits normally, we need to wait before reconnecting
            # Copy the delay back from the instance
            global_reconnect_delay = voting_system.reconnect_delay
            
            # The monitor already waited, but if connection still fails, wait again
            if not voting_system.tn:
                logger.info(f"Connection still down, waiting {global_reconnect_delay} seconds before retry...")
                time.sleep(global_reconnect_delay)
                global_reconnect_delay = min(global_reconnect_delay * 2, max_reconnect_delay)
            else:
                # Reset delay if we had a successful connection
                global_reconnect_delay = 30
                
        except KeyboardInterrupt:
            logger.info("Shutdown requested")
            break
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            logger.info(f"Waiting {global_reconnect_delay} seconds before retry...")
            time.sleep(global_reconnect_delay)
            global_reconnect_delay = min(global_reconnect_delay * 2, max_reconnect_delay)

if __name__ == "__main__":
    main()
