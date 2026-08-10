# Implementation Summary - Quest Module v0.1.3

## What Was Implemented

This implementation adds comprehensive configurability to the Quest Module, allowing server administrators to customize reset times, rewards, and quest targets via the Takaro installer's User Config dialog.

### Key Features Added

#### 1. Configurable Daily Reset Time
- **Feature**: `quest_reset_time_hhmm` config option
- **Default**: "00:15" (12:15 AM Prague time)
- **Behavior**: 
  - autoInitDailyQuests.js can now safely run every 5 minutes
  - Script checks current Prague time against configured reset time
  - Executes reset only when time matches AND hasn't run today
  - Uses `dailyquests_last_reset_at` guard variable to prevent duplicate resets

#### 2. Configurable Rewards
All quest rewards are now configurable via User Config:
- `reward_default_beers` (default: 25) - Standard quests
- `reward_vote_beers` (default: 50) - Voting quest
- `reward_unkillable_beers` (default: 50) - Future unkillable quest
- `reward_dieonce_beers` (default: 50) - Future die-once quest
- `reward_feralkills_beers` (default: 25) - Future feral kills quest
- `reward_vulturekills_beers` (default: 25) - Future vulture kills quest

#### 3. Configurable Quest Targets
All quest targets are now configurable:
- `target_timespent_ms` (default: 3600000 = 1 hour)
- `target_unkillable_ms` (default: 10800000 = 3 hours)
- `target_feralkills` (default: 10)
- `target_vulturekills` (default: 10)
- `target_dieonce` (default: 1)
- `target_zombiekills` (default: 200)
- `target_levelgain` (default: 5)
- `target_shopquest` (default: 1)

#### 4. Optional Time Tracking Toggle
- `enable_time_tracking` (default: true)
- Allows disabling time-based tracking if needed

### Files Modified

1. **Functions/questConfig.js** (NEW)
   - Shared configuration loader utility
   - `getQuestConfig()` - Loads config with fallbacks
   - `getTargetFor()` - Gets target for quest type
   - `getRewardFor()` - Gets reward for quest type
   - `getPragueTimeHHMM()` - Current Prague time in HH:mm
   - `getPragueDate()` - Current Prague date

2. **Cronjobs/autoInitDailyQuests.js**
   - Imports config loader
   - Checks current time vs configured reset time
   - Implements once-per-day guard with `dailyquests_last_reset_at`
   - Uses configured targets when creating quests
   - Error logging to `questdiag_last_error`

3. **Cronjobs/autoClaimRewards.js**
   - Imports config loader
   - Uses `getRewardFor()` to calculate rewards
   - Type-safe reward mapping

4. **Hooks/playerConnect.js**
   - Imports config loader
   - Uses configured targets when backfilling quests
   - Respects `enable_time_tracking` flag

5. **Commands/resetmydaily.js** (NEW)
   - Admin/testing command to reset daily quests
   - Rotation-aware (respects active types)
   - Uses configured targets when recreating quests
   - Resets autoclaim queue

6. **Commands/daily.js**
   - Uses shared `getPragueDate()` utility

7. **Cronjobs/questTracker.js**
   - Uses shared `getPragueDate()` utility

### Documentation Updates

1. **README.md**
   - Updated to v0.1.3
   - Added comprehensive config documentation
   - Updated cron schedule recommendations
   - Reference to CONFIG_GUIDE.md

2. **CHANGELOG.md**
   - Added v0.1.3 section with all changes
   - Technical details and migration notes

3. **CONFIG_GUIDE.md** (NEW)
   - Detailed configuration reference
   - Example configurations (Easy Mode, Hard Mode)
   - Troubleshooting guide
   - Cron schedule recommendations

## How It Works

### Configuration Loading
```javascript
const config = getQuestConfig(mod);
// Returns config with fallbacks if values not set
```

### Reset Time Gating
```javascript
const currentTime = getPragueTimeHHMM();  // e.g., "16:38"
if (currentTime !== config.quest_reset_time_hhmm) {
    return;  // Exit if not reset time
}
```

### Once-Per-Day Guard
```javascript
const guardVar = await getVariable('dailyquests_last_reset_at');
if (guardVar.value === today) {
    return;  // Already reset today
}
await updateVariable('dailyquests_last_reset_at', today);
```

### Reward Calculation
```javascript
const currencyAmount = getRewardFor(config, questType);
// Returns configured amount or fallback
```

### Target Assignment
```javascript
const target = getTargetFor(config, questType);
// Returns configured target or fallback
```

## Backward Compatibility

✅ **100% Backward Compatible**
- Works with existing installations without config
- All defaults match previous hardcoded values
- No breaking changes to existing behavior

## Testing Validation

✅ All tests passed:
- Default config fallbacks work correctly
- Partial configs use defaults for missing values
- Custom configs override all values
- Nullish coalescing handles 0 and false properly
- Helper functions map correctly
- Time utilities work in Prague timezone

## Installation Instructions

### For New Installations
1. Copy all files to Takaro module
2. Set up cron jobs (autoInitDailyQuests every 5 min)
3. Configure User Config values in installer
4. Enable commands and hooks

### For Existing v0.1.2 Users
1. Update all module files
2. Add Functions/questConfig.js
3. Add Commands/resetmydaily.js
4. Update cron schedule for autoInitDailyQuests to every 5 minutes (optional)
5. Configure User Config values (optional - uses defaults if not set)

## Cron Schedule Changes

### Before (v0.1.2)
```
autoInitDailyQuests: Once daily at specific time (complex cron)
```

### After (v0.1.3)
```
autoInitDailyQuests: */5 * * * * (Every 5 minutes)
  - Script gates execution internally
  - Runs only at configured time
  - Once-per-day guard prevents duplicates
```

## Benefits

1. **Flexibility**: Admins can customize difficulty and rewards
2. **Reliability**: Once-per-day guard ensures single execution
3. **Maintainability**: Shared config utility reduces duplication
4. **User-Friendly**: All config in Takaro installer UI
5. **Safe**: Fallbacks ensure no breakage if config missing
6. **Testable**: Config loader can be validated independently

## Future Enhancements

The config system is ready for future quest types:
- Unkillable/Deathless quests (config ready)
- Die-once quests (config ready)
- Feral zombie kills (config ready)
- Vulture kills (config ready)

Just implement the tracking logic - config is already in place!

## Support

See CONFIG_GUIDE.md for:
- Detailed configuration reference
- Example configurations
- Troubleshooting guide
- Migration instructions
