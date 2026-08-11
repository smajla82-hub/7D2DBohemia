# Changelog

All notable changes to the Quest Module will be documented in this file.

## [0.1.3] - 2025-10-10

### Added
- **Configurable Quest System**: All quest parameters now configurable via Takaro installer "User config"
  - `quest_reset_time_hhmm`: Daily reset time in HH:mm format (Europe/Prague timezone)
  - Reward configuration: `reward_default_beers`, `reward_vote_beers`, `reward_unkillable_beers`, `reward_dieonce_beers`, `reward_feralkills_beers`, `reward_vulturekills_beers`
  - Target configuration: `target_timespent_ms`, `target_unkillable_ms`, `target_feralkills`, `target_vulturekills`, `target_dieonce`, `target_zombiekills`, `target_levelgain`, `target_shopquest`
  - Optional: `enable_time_tracking` toggle
- **Shared Config Loader**: New `Functions/questConfig.js` utility with `getQuestConfig()`, `getTargetFor()`, `getRewardFor()` helpers
- **Once-Per-Day Guard**: `dailyquests_last_reset_at` variable ensures reset runs exactly once per day
- **Flexible Cron Scheduling**: autoInitDailyQuests.js can now run every 5 minutes safely with internal time-based gating
- **Admin Command**: `/resetmydaily` command for testing/admin use (rotation-aware, uses configured targets)
- **Error Diagnostics**: `questdiag_last_error` variable for logging config/guard errors

### Changed
- **autoInitDailyQuests.js**: 
  - Now checks current Prague time against `quest_reset_time_hhmm` config
  - Uses guard variable to prevent duplicate daily resets
  - Reads quest targets from config with fallback defaults
  - Can be safely scheduled every 5 minutes (e.g., */5 * * * *)
- **autoClaimRewards.js**: Reads reward amounts from config instead of hardcoded values
- **playerConnect.js**: Uses configured targets when backfilling missing quests
- **All time-based logic**: Honors `enable_time_tracking` config flag
- **Documentation**: Updated README.md with comprehensive config documentation

### Technical Details
- Config system uses nullish coalescing (`??`) for proper fallback handling
- All scripts import shared helpers from `Functions/questConfig.js`
- Reset time comparison uses Prague timezone HH:mm format
- Deterministic rotation logic unchanged (vote always included)
- Existing behavior preserved when no config values are set

### Migration Notes
- Existing installations work with default values if config not set
- Recommended cron schedule for autoInitDailyQuests.js: Every 5 minutes
- Set `quest_reset_time_hhmm` in User config to control daily reset time
- Adjust rewards/targets in User config dialog to customize quest difficulty

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
