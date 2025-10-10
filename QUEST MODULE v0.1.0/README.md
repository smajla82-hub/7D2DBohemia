# Quest Module v0.1.3

## Overview
Daily quest system for 7 Days to Die with deterministic rotation, auto-claim rewards, and configurable reset time/rewards/targets via installer.

## Features

### Configurable Settings (v0.1.3)
All quest parameters are now configurable via the Takaro module installer's "User config" dialog:

#### Reset Time Configuration
- **quest_reset_time_hhmm**: Daily reset time in HH:mm format (Europe/Prague timezone)
  - Default: `"00:15"`
  - Cron runs every 5 minutes but executes reset only once per day at this time

#### Reward Configuration (in currency/beers)
- **reward_default_beers**: Default reward for standard quests (Default: `25`)
- **reward_vote_beers**: Reward for voting quest (Default: `50`)
- **reward_unkillable_beers**: Reward for unkillable quest (Default: `50`)
- **reward_dieonce_beers**: Reward for die-once quest (Default: `50`)
- **reward_feralkills_beers**: Reward for feral kills quest (Default: `25`)
- **reward_vulturekills_beers**: Reward for vulture kills quest (Default: `25`)

#### Quest Target Configuration
- **target_timespent_ms**: Time to play in milliseconds (Default: `3600000` = 1 hour)
- **target_unkillable_ms**: Time without dying in milliseconds (Default: `10800000` = 3 hours)
- **target_feralkills**: Number of feral zombies to kill (Default: `10`)
- **target_vulturekills**: Number of vultures to kill (Default: `10`)
- **target_dieonce**: Must die exactly once (Default: `1`)
- **target_zombiekills**: Number of zombies to kill (Default: `200`)
- **target_levelgain**: Levels to gain (Default: `5`)
- **target_shopquest**: Shop purchases needed (Default: `1`)

#### Optional Settings
- **enable_time_tracking**: Enable/disable time tracking (Default: `true`)

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
1. **autoInitDailyQuests.js** - Runs every 5 minutes (executes once per day at configured time)
   - Checks if current Prague time matches `quest_reset_time_hhmm` config
   - Uses `dailyquests_last_reset_at` guard to ensure single daily execution
   - Deletes old quest variables (retention=0)
   - Creates new daily quests with rotation using configured targets
   - Stores global active types variable
   - Can be safely scheduled every 5 minutes; internal guard prevents duplicate resets

2. **questTracker.js** - Runs every 15 seconds
   - Tracks zombie kills, shop purchases, time spent
   - Enqueues completed quests for auto-claim
   - Sends completion notifications

3. **autoClaimRewards.js** - Runs every 15 seconds  
   - Processes auto-claim queue
   - Awards currency for completed quests using configured reward amounts
   - Sends reward notifications

## Installation

1. Copy all files from `QUEST MODULE v0.1.0/` to your Takaro module
2. Configure the following in Takaro:
   - **Cronjobs**: Set up the 3 cron jobs listed above
     - autoInitDailyQuests.js: Every 5 minutes (*/5 * * * *)
     - questTracker.js: Every 15 seconds
     - autoClaimRewards.js: Every 15 seconds
   - **Hook**: Set playerConnect.js to trigger on `player-connected` event
   - **Commands**: Enable `/daily`, `/initquests`, and `/resetmydaily` (admin only)
   - **User Config**: Configure quest parameters via the installer dialog:
     - Set `quest_reset_time_hhmm` for your preferred daily reset time
     - Adjust reward amounts (`reward_*_beers` fields)
     - Modify quest targets (`target_*` fields)

3. External integration:
   - Python `integrated_game_monitor.py` handles level-gain quest updates

## Quest Types

Current active quest types (configurable targets via installer):
- **TIME SURVIVOR**: Play for configured time (default: 1 hour)
- **SERVER SUPPORTER**: Vote for the server once
- **ZOMBIE HUNTER**: Kill configured number of zombies (default: 200)
- **EXPERIENCE GRINDER**: Gain configured levels (default: 5)
- **TRADE BEERS**: Purchase from shop configured times (default: 1)

Future quest types (config ready, not yet implemented in tracker):
- **UNKILLABLE**: Survive without dying for configured time (default: 3 hours)
- **DIE ONCE**: Die exactly once (default: 1)
- **FERAL HUNTER**: Kill configured feral zombies (default: 10)
- **VULTURE HUNTER**: Kill configured vultures (default: 10)

## Rewards

Reward amounts are fully configurable via installer:
- Standard quests: Default 25 currency (configurable via `reward_default_beers`)
- Vote quest: Default 50 currency (configurable via `reward_vote_beers`)
- Special quests: Individual config fields (e.g., `reward_unkillable_beers`)

## Version History
See CHANGELOG.md for detailed version history.
