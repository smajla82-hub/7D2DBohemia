# Changelog

All notable changes to the Quest Module will be documented in this file.

## [0.1.2] - 2025-10-10

### Added
- **Deterministic Quest Rotation**: Daily quests now rotate based on date and server ID
  - Vote quest remains permanent in rotation
  - 2 additional quests selected deterministically from: timespent, zombiekills, levelgain, shopquest
  - Same rotation for all players on a server each day
- **Global Active Types Variable**: `dailyquests_active_types_{date}` stores active quest types per day
- **Auto-Claim System**: Automated reward claiming via `autoClaimRewards.js` cron
  - Runs every 15 seconds
  - Processes completion queue
  - Awards currency automatically
  - ✪ wrapper in award notifications
  - Proper pluralization (quest/quests)
- **Enhanced Completion Messages**: 
  - ✔ checkmark at both ends of completion message
  - Removed exclamation mark after "completed"

### Changed
- **Single-PM Compact Display**: `/daily` command now shows all quests in one message
  - BMP-safe icons: ✪ for title, ※ for bullets, ✔ for READY/CLAIMED
  - Replaced previous multi-PM layout
  - Shows "Auto-claim active, rewards coming soon!" when quests are ready
- **Prague Timezone**: All date handling standardized to Europe/Prague (CET/CEST)
  - Affects: autoInitDailyQuests.js, playerConnect.js, daily.js, questTracker.js
- **Retention Policy**: Set to 0 - all old dailyquest_* variables deleted before creating new ones
- **Session Creation**: Only creates session variable if timespent quest is active
- **Player Connect Hook**: 
  - Rotation-aware quest creation
  - Only creates quests for today's active types
  - No diagnostic logs (cleaner operation)

### Removed
- **Manual Claim Command**: `/dailyclaim` command removed (replaced by auto-claim)

### Technical Details
- **Rotation Algorithm**: Uses deterministic seed from date + server ID
- **Queue System**: Uses `autoclaim_queue_{playerId}` variable for tracking completed quests
- **TS-Safe JSON Parsing**: Robust error handling for all JSON.parse operations
- **Quest Enqueuing**: questTracker.js enqueues completed quests for auto-claim

### Migration Notes
- Existing `/dailyclaim` users: Rewards now claim automatically
- Cron setup required: Ensure `autoClaimRewards.js` runs every 15 seconds
- All players will see rotated quests starting from deployment date

## [0.1.0] - Previous Version

### Added
- Fixed "??" prefix in PMs by replacing with safe checkmark (✔)
- Standardized date handling to Europe/Prague (CEST/CET) 
- Restored and simplified time-spent tracking
- Implemented robust auto-init at 00:15 server time with retention=0
- Player connect hook ensures current day's quests are present
- Added `/resetmydaily` temporary admin testing command

### Changed
- Removed invalid Takaro 'level-up' event usage
- levelgain continues to be handled externally by Python integrated_game_monitor.py

### Files
- Cronjobs/questTracker.js
- Cronjobs/autoInitDailyQuests.js  
- Hooks/playerConnect.js
- Commands/resetmydaily.js
- Commands/daily.js
- Commands/dailyclaim.js
- Commands/initquests.js

## [0.0.19] - Initial Version

Initial implementation with basic quest system.
