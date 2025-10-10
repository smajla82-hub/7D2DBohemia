# Quest Module v0.1.2

## Overview
Daily quest system for 7 Days to Die with deterministic rotation, auto-claim rewards, and enhanced player experience.

## Features

### Quest Rotation (v0.1.2)
- **Deterministic Daily Rotation**: Quest types rotate daily based on date and server ID
- **Vote Always Active**: The voting quest is always available
- **2 Additional Quests**: System randomly selects 2 more from: Time Survivor, Zombie Hunter, Experience Grinder, Trade Beers
- **Per-Server Consistency**: All players on a server get the same quest rotation each day

### Auto-Claim System (v0.1.2)
- Rewards are automatically claimed 5-15 seconds after quest completion
- No manual `/dailyclaim` command needed
- Award notification uses ✪ decorative wrapper
- Proper pluralization in reward messages

### Display & UI (v0.1.2)
- **Single Compact PM**: All quest info in one message via `/daily`
- **BMP-Safe Icons**: 
  - ✪ for title wrapper
  - ※ for bullet points
  - ✔ for READY/CLAIMED status
- **Completion Messages**: ✔ at both ends, no exclamation marks

### Prague Timezone
All daily resets and quest tracking use Europe/Prague timezone (CET/CEST) for consistency.

## Commands

### Player Commands
- `/daily` - View current daily quests and progress
- `/initquests` - Initialize quests manually (fallback, rarely needed)

### Admin Commands  
- `/resetmydaily` - Reset your own daily quests (testing/admin only)

## Cronjobs

### Required Cron Jobs
1. **autoInitDailyQuests.js** - Runs at 00:15 Prague time
   - Deletes old quest variables (retention=0)
   - Creates new daily quests with rotation
   - Stores global active types variable

2. **questTracker.js** - Runs every 15 seconds
   - Tracks zombie kills, shop purchases, time spent
   - Enqueues completed quests for auto-claim
   - Sends completion notifications

3. **autoClaimRewards.js** - Runs every 15 seconds  
   - Processes auto-claim queue
   - Awards currency for completed quests
   - Sends reward notifications

## Installation

1. Copy all files from `QUEST MODULE v0.1.0/` to your Takaro module
2. Configure the following in Takaro:
   - **Cronjobs**: Set up the 3 cron jobs listed above
   - **Hook**: Set playerConnect.js to trigger on `player-connected` event
   - **Commands**: Enable `/daily` and `/initquests` (optionally `/resetmydaily` for admins)

3. External integration:
   - Python `integrated_game_monitor.py` handles level-gain quest updates

## Quest Types

- **TIME SURVIVOR**: Play for 1 hour (3600000ms)
- **SERVER SUPPORTER**: Vote for the server once
- **ZOMBIE HUNTER**: Kill 200 zombies
- **EXPERIENCE GRINDER**: Gain 5 levels
- **TRADE BEERS**: Purchase from shop once

## Rewards
- Standard quests: 25 currency
- Vote quest: 50 currency

## Version History
See CHANGELOG.md for detailed version history.
