# 7D2D Bohemia - Quest System

## Overview

This repository contains a comprehensive daily quest system for 7 Days to Die servers managed via Takaro. The system consists of two main components:

### Architecture

1. **Quest Module (Takaro)**
   - Runs within the Takaro platform as a custom module
   - Manages quest lifecycle: initialization, tracking, completion, and rewards
   - Provides player commands (`/daily`, `/resetmydaily`)
   - Automated cronjobs for quest management
   - Location: `QUEST MODULE v0.1.0/` directory

2. **Server Integration (Game Host)**
   - Node.js integration server (`takaro-quest-integration_server/`)
   - Python voting script (`Voting/voting_rewards.py`)
   - Runs on the game server host to detect external events
   - Communicates quest updates to Takaro via REST API

### Repository Structure

```
7D2DBohemia/
├── QUEST MODULE v0.1.0/        # Takaro module files
│   ├── Commands/                # Player and admin commands
│   ├── Cronjobs/                # Automated quest management
│   ├── Hooks/                   # Event handlers (player connect)
│   ├── Functions/               # Shared utilities (questConfig.js)
│   ├── README.md                # Module documentation
│   ├── CONFIG_GUIDE.md          # Configuration reference
│   └── CHANGELOG.md             # Version history
├── takaro-quest-integration_server/  # Server-side integration
│   ├── working_server.js        # HTTP server for quest updates
│   └── takaro_client.js         # Takaro API client (v2.1)
├── Voting/
│   └── voting_rewards.py        # Vote detection script (v34)
├── RELEASES/                    # Release notes
├── README.md                    # This file
└── DEPLOY.md                    # Deployment guide
```

## Versioning

**Important**: The folder name "QUEST MODULE v0.1.0" is historical and does not reflect the current version.

- **Current Release**: v0.2.1
- **Canonical Version Source**: GitHub Releases (tags)
- **Module Files**: Always reference the exact commit hash for reproducible deployments

### Finding the Latest Version

- **GitHub Releases**: [https://github.com/smajla82-hub/7D2DBohemia/releases](https://github.com/smajla82-hub/7D2DBohemia/releases)
- **Latest Release**: [v0.2.1](https://github.com/smajla82-hub/7D2DBohemia/releases/tag/v0.2.1)

### Module Runtime Files (v0.2.1 - Commit 0f125fe)

The following files comprise the Quest System v0.2.1. Use these permalink URLs to copy the exact version:

**Commands:**
- [daily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/daily.js)
- [resetmydaily.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Commands/resetmydaily.js)

**Cronjobs:**
- [autoInitDailyQuests.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoInitDailyQuests.js)
- [autoClaimRewards.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/autoClaimRewards.js)
- [questTracker.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Cronjobs/questTracker.js)

**Hooks:**
- [playerConnect.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Hooks/playerConnect.js)

**Functions:**
- [questConfig.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/QUEST%20MODULE%20v0.1.0/Functions/questConfig.js)

**Server Integration:**
- [working_server.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/working_server.js)
- [takaro_client.js](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/takaro-quest-integration_server/takaro_client.js)
- [voting_rewards.py](https://github.com/smajla82-hub/7D2DBohemia/blob/0f125fe5da361dd03d587ad12aa3f4933dcbf2b2/Voting/voting_rewards.py)

## Quick Start

To deploy Quest System v0.2.1 to your server:

1. **Read the deployment guide**: [DEPLOY.md](DEPLOY.md)
2. **Update Takaro module files** using the permalink URLs above
3. **Configure User config values** in the Takaro installer
4. **Set up server integration** on your game host
5. **Verify the installation** with test commands

For detailed step-by-step instructions, see [DEPLOY.md](DEPLOY.md).

## Features (v0.2.1)

- **Permanent Quests**: Vote and levelgain quests are ALWAYS active
- **Rotating Quests**: Three additional quest types rotate daily (unkillable, dieonce, feralkills, vulturekills, timespent, zombiekills, shopquest)
- **Configurable Everything**: Reset time, rewards, and targets via Takaro User config
- **Auto-Claim System**: Rewards automatically awarded on completion (enqueue support for external updates)
- **ASCII-Only Messages**: Safe private messaging without Unicode issues
- **Deterministic Rotation**: Same daily quests for all players on a server
- **Prague Timezone**: Consistent Europe/Prague (CET/CEST) time handling

## Documentation

- **[DEPLOY.md](DEPLOY.md)** - Complete deployment guide for v0.2.1
- **[RELEASES/v0.2.1.md](RELEASES/v0.2.1.md)** - Release notes and changelog
- **[QUEST MODULE v0.1.0/README.md](QUEST%20MODULE%20v0.1.0/README.md)** - Module technical documentation
- **[QUEST MODULE v0.1.0/CONFIG_GUIDE.md](QUEST%20MODULE%20v0.1.0/CONFIG_GUIDE.md)** - Configuration reference
- **[QUEST MODULE v0.1.0/CHANGELOG.md](QUEST%20MODULE%20v0.1.0/CHANGELOG.md)** - Complete version history

## Support

For issues, questions, or contributions, please open an issue on GitHub.

## License

This project is provided as-is for use with 7 Days to Die servers.
