# Quest Module Configuration Guide

This document describes all available user configuration options for the Quest Module v0.1.3+.

## Configuration Method

All settings are configured via the Takaro module installer's **User Config** dialog. When creating or editing the module in Takaro, you'll see a configuration form where you can set these values.

## Available Configuration Options

### Reset Time Configuration

#### quest_reset_time_hhmm
- **Type**: String (HH:mm format)
- **Default**: `"00:15"`
- **Description**: Daily reset time in Europe/Prague timezone (CET/CEST)
- **Examples**: 
  - `"00:15"` - Reset at 12:15 AM Prague time
  - `"06:00"` - Reset at 6:00 AM Prague time
  - `"23:30"` - Reset at 11:30 PM Prague time
- **Important**: The autoInitDailyQuests.js cron should run every 5 minutes. The script will automatically execute the reset only at the configured time, once per day.

### Reward Configuration (Currency/Beers)

#### reward_default_beers
- **Type**: Number
- **Default**: `25`
- **Description**: Default reward for standard quests (timespent, zombiekills, levelgain, shopquest)

#### reward_vote_beers
- **Type**: Number
- **Default**: `50`
- **Description**: Reward for completing the voting quest

#### reward_unkillable_beers
- **Type**: Number
- **Default**: `50`
- **Description**: Reward for unkillable/deathless quest (future implementation)

#### reward_dieonce_beers
- **Type**: Number
- **Default**: `50`
- **Description**: Reward for die-once quest (future implementation)

#### reward_feralkills_beers
- **Type**: Number
- **Default**: `25`
- **Description**: Reward for feral zombie kills quest (future implementation)

#### reward_vulturekills_beers
- **Type**: Number
- **Default**: `25`
- **Description**: Reward for vulture kills quest (future implementation)

### Quest Target Configuration

#### target_timespent_ms
- **Type**: Number (milliseconds)
- **Default**: `3600000` (1 hour)
- **Description**: Time player must spend online to complete TIME SURVIVOR quest
- **Examples**:
  - `1800000` - 30 minutes
  - `3600000` - 1 hour (default)
  - `7200000` - 2 hours

#### target_unkillable_ms
- **Type**: Number (milliseconds)
- **Default**: `10800000` (3 hours)
- **Description**: Time player must survive without dying (future implementation)

#### target_feralkills
- **Type**: Number
- **Default**: `10`
- **Description**: Number of feral zombies to kill (future implementation)

#### target_vulturekills
- **Type**: Number
- **Default**: `10`
- **Description**: Number of vultures to kill (future implementation)

#### target_dieonce
- **Type**: Number
- **Default**: `1`
- **Description**: Number of times player must die (typically 1) (future implementation)

#### target_zombiekills
- **Type**: Number
- **Default**: `200`
- **Description**: Number of zombies to kill for ZOMBIE HUNTER quest

#### target_levelgain
- **Type**: Number
- **Default**: `5`
- **Description**: Levels to gain for EXPERIENCE GRINDER quest

#### target_shopquest
- **Type**: Number
- **Default**: `1`
- **Description**: Number of shop purchases for TRADE BEERS quest

### Optional Settings

#### enable_time_tracking
- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable or disable time-based quest tracking (timespent, unkillable)
- **Note**: Set to `false` to disable time tracking if it causes performance issues

## Example Configurations

### Easy Mode (Casual Server)
```json
{
  "quest_reset_time_hhmm": "06:00",
  "reward_default_beers": 50,
  "reward_vote_beers": 100,
  "target_timespent_ms": 1800000,
  "target_zombiekills": 100,
  "target_levelgain": 3,
  "target_shopquest": 1
}
```

### Hard Mode (Challenging Server)
```json
{
  "quest_reset_time_hhmm": "00:00",
  "reward_default_beers": 15,
  "reward_vote_beers": 30,
  "target_timespent_ms": 7200000,
  "target_zombiekills": 500,
  "target_levelgain": 10,
  "target_shopquest": 3
}
```

### Default Configuration
If no config is set, the module uses these defaults:
```json
{
  "quest_reset_time_hhmm": "00:15",
  "reward_default_beers": 25,
  "reward_vote_beers": 50,
  "reward_unkillable_beers": 50,
  "reward_dieonce_beers": 50,
  "reward_feralkills_beers": 25,
  "reward_vulturekills_beers": 25,
  "target_timespent_ms": 3600000,
  "target_unkillable_ms": 10800000,
  "target_feralkills": 10,
  "target_vulturekills": 10,
  "target_dieonce": 1,
  "target_zombiekills": 200,
  "target_levelgain": 5,
  "target_shopquest": 1,
  "enable_time_tracking": true
}
```

## How Configuration Works

1. **Fallback System**: If a config value is not set, the module uses sensible defaults
2. **Runtime Loading**: Configuration is loaded from `mod.userConfig` at runtime
3. **No Restart Required**: Changes take effect on next cron run or player action
4. **Null-Safe**: Uses nullish coalescing (`??`) to handle missing values properly

## Cron Schedule Recommendations

### autoInitDailyQuests.js
- **Recommended**: `*/5 * * * *` (Every 5 minutes)
- **Why**: The script gates execution by comparing current time to `quest_reset_time_hhmm`
- **Guard**: Uses `dailyquests_last_reset_at` variable to ensure single daily execution

### questTracker.js
- **Recommended**: Every 15 seconds
- **Why**: Tracks real-time quest progress (kills, shop purchases, time spent)

### autoClaimRewards.js
- **Recommended**: Every 15 seconds
- **Why**: Processes auto-claim queue for completed quests

## Troubleshooting

### Reset not running at configured time
1. Check that `quest_reset_time_hhmm` is in HH:mm format (e.g., "06:00", not "6:00")
2. Verify autoInitDailyQuests.js cron is running every 5 minutes
3. Check `questdiag_last_error` variable for any error messages
4. Ensure time is in Europe/Prague timezone

### Quests have wrong targets
1. Verify User Config values are set correctly
2. Use `/resetmydaily` command to recreate quests with new targets
3. Check that values are numbers (not strings) for numeric configs

### Rewards are incorrect
1. Update User Config with desired reward amounts
2. New amounts apply to quests completed after the change
3. Already-claimed quests retain their original reward amount

## Migration from v0.1.2

No migration needed! The module automatically uses defaults if no config is set, maintaining backward compatibility with existing installations.

To take advantage of new features:
1. Update module files to v0.1.3
2. Configure User Config values in Takaro installer
3. Update autoInitDailyQuests.js cron to run every 5 minutes (optional)
4. Set `quest_reset_time_hhmm` to your preferred reset time
