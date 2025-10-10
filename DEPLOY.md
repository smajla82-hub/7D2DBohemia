# Quest System v0.2.1 - Deployment Guide

This guide walks you through deploying Quest System v0.2.1 to your 7 Days to Die server managed by Takaro.

## Prerequisites

- Takaro platform access with module editing permissions
- SSH/RDP access to your game server host
- Node.js and npm installed on game server (for integration server)
- Python 3 installed on game server (for voting script)
- PM2 process manager (recommended for server integration)

## Deployment Overview

1. Update Takaro module files (7 files)
2. Configure User config values
3. Set up cronjob schedules
4. Deploy server integration on game host
5. Verify installation

---

## Part 1: Update Takaro Module Files

In your Takaro dashboard, navigate to your Quest Module and update the following files. **Copy the exact content from the permalinks below** (commit 0f125fe):

### Commands

#### 1. Commands/daily.js
**Permalink**: [daily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/daily.js)

In Takaro:
1. Navigate to Module > Commands > daily
2. Open the file in raw mode from GitHub (click "Raw" button)
3. Copy entire content
4. Paste into Takaro command code editor
5. Save

#### 2. Commands/resetmydaily.js
**Permalink**: [resetmydaily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/resetmydaily.js)

Follow same process as above.

### Cronjobs

#### 3. Cronjobs/autoInitDailyQuests.js
**Permalink**: [autoInitDailyQuests.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoInitDailyQuests.js)

In Takaro:
1. Navigate to Module > Cronjobs > autoInitDailyQuests
2. Copy content from GitHub permalink
3. Paste into Takaro cronjob code editor
4. Save

#### 4. Cronjobs/autoClaimRewards.js
**Permalink**: [autoClaimRewards.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoClaimRewards.js)

Follow same process.

#### 5. Cronjobs/questTracker.js
**Permalink**: [questTracker.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/questTracker.js)

Follow same process.

### Hooks

#### 6. Hooks/playerConnect.js
**Permalink**: [playerConnect.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Hooks/playerConnect.js)

In Takaro:
1. Navigate to Module > Hooks > playerConnect
2. Ensure hook is set to trigger on `player-connected` event
3. Copy content from GitHub permalink
4. Paste into Takaro hook code editor
5. Save

### Functions

#### 7. Functions/questConfig.js
**Permalink**: [questConfig.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Functions/questConfig.js)

In Takaro:
1. Navigate to Module > Functions > questConfig
2. Copy content from GitHub permalink
3. Paste into Takaro function code editor
4. Save

---

## Part 2: Configure User Config Values

In the Takaro module installer's "User config" dialog, set the following values:

### Reset Time Configuration

| Config Key | Value | Description |
|------------|-------|-------------|
| `quest_reset_time_hhmm` | `"00:15"` | Daily reset time in HH:mm format (Europe/Prague timezone) |

### Reward Configuration (Currency/Beers)

| Config Key | Default Value | Description |
|------------|---------------|-------------|
| `reward_default_beers` | `25` | Reward for standard rotating quests |
| `reward_vote_beers` | `50` | Reward for voting quest |
| `reward_unkillable_beers` | `50` | Reward for unkillable quest |
| `reward_dieonce_beers` | `50` | Reward for die-once quest |
| `reward_feralkills_beers` | `25` | Reward for feral kills quest |
| `reward_vulturekills_beers` | `25` | Reward for vulture kills quest |

### Quest Target Configuration

| Config Key | Default Value | Description |
|------------|---------------|-------------|
| `target_timespent_ms` | `3600000` | Time to play (1 hour in milliseconds) |
| `target_unkillable_ms` | `10800000` | Time without dying (3 hours in milliseconds) |
| `target_feralkills` | `10` | Number of feral zombies to kill |
| `target_vulturekills` | `10` | Number of vultures to kill |
| `target_dieonce` | `1` | Must die exactly once |
| `target_zombiekills` | `200` | Number of zombies to kill |
| `target_levelgain` | `5` | Levels to gain |
| `target_shopquest` | `1` | Shop purchases needed |

### Optional Settings

| Config Key | Default Value | Description |
|------------|---------------|-------------|
| `enable_time_tracking` | `true` | Enable/disable time-based quest tracking |

**Note**: All config values shown are the recommended defaults. Adjust rewards and targets to match your server's economy and difficulty.

---

## Part 3: Configure Cronjob Schedules

Set the following cron schedules in Takaro:

### autoInitDailyQuests.js
- **Recommended Schedule**: `*/5 * * * *` (Every 5 minutes)
- **Why**: The script internally checks if it's time to reset based on `quest_reset_time_hhmm`. Running every 5 minutes ensures timely resets without duplicate execution (guarded by `dailyquests_last_reset_at` variable).

### questTracker.js
- **Recommended Schedule**: Every 15 seconds
- **Why**: Tracks real-time quest progress (kills, shop purchases, time spent)

### autoClaimRewards.js
- **Recommended Schedule**: Every 15 seconds
- **Why**: Processes auto-claim queue for completed quests. Polls for both externally-completed quests (from server integration) and internally-completed quests.

---

## Part 4: Server Integration on Game Host

The server integration allows external events (voting, level-ups) to update quest progress.

### A. Install Node.js Integration Server

1. **SSH into your game server host**

2. **Navigate to integration directory** (or create it):
   ```bash
   cd /path/to/your/server
   mkdir -p takaro-quest-integration
   cd takaro-quest-integration
   ```

3. **Download working_server.js**:
   
   **Permalink**: [working_server.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/working_server.js)
   
   ```bash
   wget https://raw.githubusercontent.com/smajla82-hub/7D2DBohemia/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/working_server.js
   ```

4. **Download takaro_client.js (v2.1)**:
   
   **Permalink**: [takaro_client.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/takaro_client.js)
   
   ```bash
   wget https://raw.githubusercontent.com/smajla82-hub/7D2DBohemia/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/takaro_client.js
   ```

5. **Install dependencies**:
   ```bash
   npm init -y
   npm install @takaro/apiclient express
   ```

6. **Configure takaro_client.js**:
   
   Edit `takaro_client.js` and update the CONFIG section with your Takaro credentials:
   ```javascript
   const CONFIG = {
     url: 'https://api.takaro.io',
     auth: {
       username: 'your-takaro-email@example.com',
       password: 'your-takaro-password',
     },
     gameServerId: 'your-game-server-id',
     moduleId: 'your-quest-module-id'
   };
   ```

7. **Start with PM2**:
   ```bash
   pm2 start working_server.js --name quest-integration
   pm2 save
   ```

8. **Verify it's running**:
   ```bash
   pm2 status
   curl http://localhost:3000/health
   ```
   
   Expected response:
   ```json
   {
     "status": "running",
     "authenticated": true,
     "timestamp": "2025-10-10T19:30:00.000Z"
   }
   ```

### B. Install Python Voting Script

1. **Download voting_rewards.py (v34)**:
   
   **Permalink**: [voting_rewards.py](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/Voting/voting_rewards.py)
   
   ```bash
   cd /path/to/your/scripts
   wget https://raw.githubusercontent.com/smajla82-hub/7D2DBohemia/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/Voting/voting_rewards.py
   ```

2. **Install Python dependencies**:
   ```bash
   pip3 install requests pytz
   ```

3. **Configure voting_rewards.py**:
   
   Edit the script and update configuration:
   - Telnet host/port for your 7D2D server
   - Telnet password
   - Quest integration server URL (http://localhost:3000)

4. **Start with PM2** (or systemd):
   ```bash
   pm2 start voting_rewards.py --name voting-rewards --interpreter python3
   pm2 save
   ```

5. **Verify it's running**:
   ```bash
   pm2 status
   pm2 logs voting-rewards --lines 20
   ```

### C. Test the Integration

1. **Test quest update endpoint**:
   ```bash
   curl -X POST http://localhost:3000/update-quest \
     -H "Content-Type: application/json" \
     -d '{"playerName": "TestPlayer", "questType": "vote", "increment": 1}'
   ```

2. **Check PM2 logs**:
   ```bash
   pm2 logs quest-integration --lines 50
   ```

3. **Verify in-game**: Have a player vote and check if quest progress updates.

---

## Part 5: Verification Steps

After deployment, verify the system is working correctly:

### 1. Test Player Commands

Join the game server and run:
```
/daily
```

**Expected**: You should see a private message listing your daily quests (vote, levelgain, and 3 rotating quests).

### 2. Test Voting Quest

1. Have a player vote for the server
2. Wait 10-30 seconds for the voting script to detect it
3. Check quest progress with `/daily`

**Expected**: Vote quest progress should increment by 1.

### 3. Test Level-Up Quest

1. Gain XP to level up
2. Wait for questTracker.js to run (15 seconds)
3. Check quest progress with `/daily`

**Expected**: Levelgain quest progress should increment.

### 4. Check Server Variables

In Takaro dashboard, view server variables:
- `dailyquests_last_reset_at` - Should show last reset timestamp
- `dailyquests_active_types_{date}` - Should show active quest types (e.g., "vote,levelgain,unkillable,feralkills,timespent")

### 5. Verify Auto-Claim

1. Complete any quest (e.g., die once for dieonce quest)
2. Wait 15-30 seconds
3. Check in-game chat

**Expected**: You should receive an auto-claim message with your reward:
```
*** You have been awarded 50 beers! Quest completed ***
```

### 6. Test Admin Commands

As an admin, test the reset command:
```
/resetmydaily
```

**Expected**: Your daily quests should reset with new rotation.

---

## Troubleshooting

### Quest Progress Not Updating

1. Check cronjob schedules (questTracker should run every 15s)
2. Verify `enable_time_tracking` is set to `true` for time-based quests
3. Check server logs in Takaro dashboard

### Auto-Claim Not Working

1. Verify autoClaimRewards.js is running every 15 seconds
2. Check reward configuration values are set correctly
3. Look for errors in Takaro cronjob logs

### Server Integration Not Working

1. Check PM2 status: `pm2 status`
2. View logs: `pm2 logs quest-integration`
3. Test authentication: `curl http://localhost:3000/health`
4. Verify takaro_client.js credentials are correct

### Voting Not Detected

1. Check voting_rewards.py is running: `pm2 status`
2. View logs: `pm2 logs voting-rewards`
3. Verify telnet credentials in voting_rewards.py
4. Test quest server: `curl http://localhost:3000/health`

### Quests Not Resetting Daily

1. Verify `quest_reset_time_hhmm` is set in User config
2. Check `dailyquests_last_reset_at` variable in Takaro
3. Ensure autoInitDailyQuests.js cron is running every 5 minutes
4. Check server timezone (should use Europe/Prague)

---

## Configuration Examples

### Casual Server (Easy Mode)

```javascript
quest_reset_time_hhmm: "00:15"
reward_default_beers: 50
reward_vote_beers: 100
target_zombiekills: 100
target_levelgain: 3
target_timespent_ms: 1800000  // 30 minutes
```

### Hardcore Server (Hard Mode)

```javascript
quest_reset_time_hhmm: "00:15"
reward_default_beers: 10
reward_vote_beers: 25
target_zombiekills: 500
target_levelgain: 10
target_unkillable_ms: 21600000  // 6 hours
```

---

## Post-Deployment

After successful deployment:

1. **Monitor for 24 hours** to ensure daily reset occurs correctly
2. **Gather player feedback** on quest difficulty and rewards
3. **Adjust config values** as needed (no restart required)
4. **Join the community** - share your experience and setup

For support or questions, open an issue on [GitHub](https://github.com/smajla82-hub/7D2DBohemia/issues).

---

## Quick Reference: File Permalinks (Commit 0f125fe)

Copy these exact versions for v0.2.1:

- [Commands/daily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/daily.js)
- [Commands/resetmydaily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/resetmydaily.js)
- [Cronjobs/autoInitDailyQuests.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoInitDailyQuests.js)
- [Cronjobs/autoClaimRewards.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoClaimRewards.js)
- [Cronjobs/questTracker.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/questTracker.js)
- [Hooks/playerConnect.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Hooks/playerConnect.js)
- [Functions/questConfig.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Functions/questConfig.js)
- [working_server.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/working_server.js)
- [takaro_client.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/takaro_client.js)
- [voting_rewards.py](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/Voting/voting_rewards.py)
