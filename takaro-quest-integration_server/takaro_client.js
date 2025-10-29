// takaro_client.js - Core Takaro API client (v2.1)
// - ASCII-only messages (avoid '??' in-game)
// - Enqueue auto-claim for externally completed quests (vote/levelgain)
// - No extra PM on completion (avoid duplicates); the award PM will come from the module
import { Client } from '@takaro/apiclient';

const CONFIG = {
  url: 'https://api.takaro.io',
  auth: {
    username: 'smajla82@gmail.com',
    password: 'b82r03e14j23C10',
  },
  gameServerId: 'd7524118-c464-4ad9-91a0-57da9b4ad269',
  moduleId: 'ddbe24ed-58ae-4f53-899c-9a99f8029135'
};

const TIME_ZONE = 'Europe/Prague';
const PENDING_PREFIX = 'autoclaim_pending_';

function pragueDateString() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Safe parser for pending payload
function parsePendingPayload(str) {
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      const items = parsed.items
        .filter((i) => i && typeof i.type === 'string')
        .map((i) => ({
          type: String(i.type),
          completedAt: typeof i.completedAt === 'number' ? i.completedAt : Date.now(),
        }));
      return { items };
    }
  } catch {}
  return { items: [] };
}

class TakaroQuestClient {
  constructor() {
    this.client = new Client(CONFIG);
    this.authenticated = false;
    this.playerCache = new Map();
  }

  async authenticate() {
    try {
      console.log('[Takaro] Authenticating...');
      await this.client.login();
      this.authenticated = true;
      console.log('[Takaro] Authenticated');
      return true;
    } catch (error) {
      console.error('[Takaro] Auth failed:', error?.message || error);
      this.authenticated = false;
      return false;
    }
  }

  async ensureAuthenticated() {
    if (!this.authenticated) return await this.authenticate();
    return true;
  }

  async findPlayerByName(playerName) {
    try {
      if (this.playerCache.has(playerName)) return this.playerCache.get(playerName);
      let response;
      try {
        response = await this.client.player.playerControllerSearch({ filters: { name: [playerName] } });
      } catch (err) {
        if (err?.response?.status === 401) {
          await this.authenticate();
          response = await this.client.player.playerControllerSearch({ filters: { name: [playerName] } });
        } else throw err;
      }
      if (response?.data?.data?.length > 0) {
        const playerId = response.data.data[0].id;
        this.playerCache.set(playerName, playerId);
        return playerId;
      }
      return null;
    } catch (error) {
      console.error(`[Takaro] findPlayerByName error for ${playerName}:`, error?.message || error);
      return null;
    }
  }

  async getDailyDate() {
    try {
      let res;
      try {
        res = await this.client.variable.variableControllerSearch({
          filters: { key: ['dailyquests_current_date'], gameServerId: [CONFIG.gameServerId], moduleId: [CONFIG.moduleId] }
        });
      } catch (err) {
        if (err?.response?.status === 401) {
          await this.authenticate();
          res = await this.client.variable.variableControllerSearch({
            filters: { key: ['dailyquests_current_date'], gameServerId: [CONFIG.gameServerId], moduleId: [CONFIG.moduleId] }
          });
        } else throw err;
      }
      if (res?.data?.data?.length) return String(res.data.data[0].value);
    } catch {}
    return pragueDateString();
  }

  mapQuestType(external) {
    switch (external) {
      case 'levelup': return 'levelgain';
      case 'playtime': return 'timespent';
      case 'kills': return 'zombiekills';
      default: return external; // vote, levelgain, etc.
    }
  }

  async getQuestTargets(questType) {
    const targets = {
      vote: 1,
      levelgain: 5,
      zombiekills: 200,
      timespent: 3600000,
      shopquest: 1
    };
    return targets[questType] || 1;
  }

  async enqueueAutoClaim(playerId, date, type) {
    const key = `${PENDING_PREFIX}${playerId}_${date}`;
    try {
      // Search existing pending record
      let existing;
      try {
        existing = await this.client.variable.variableControllerSearch({
          filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] }
        });
      } catch (err) {
        if (err?.response?.status === 401) {
          await this.authenticate();
          existing = await this.client.variable.variableControllerSearch({
            filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] }
          });
        } else throw err;
      }

      const now = Date.now();
      if (existing?.data?.data?.length) {
        const rec = existing.data.data[0];
        const payload = parsePendingPayload(rec.value || '{}');
        if (!payload.items.find((i) => i.type === type)) {
          payload.items.push({ type, completedAt: now });
          await this.client.variable.variableControllerUpdate(rec.id, { value: JSON.stringify(payload) });
        }
      } else {
        const payload = { items: [{ type, completedAt: now }] };
        await this.client.variable.variableControllerCreate({
          key,
          value: JSON.stringify(payload),
          gameServerId: CONFIG.gameServerId,
          playerId,
          moduleId: CONFIG.moduleId
        });
      }
    } catch (e) {
      console.error('[Takaro] enqueueAutoClaim error:', e?.message || e);
    }
  }

  async updateQuestProgress(playerId, questType, increment = 1) {
    try {
      if (!await this.ensureAuthenticated()) throw new Error('Authentication failed');

      const type = this.mapQuestType(questType);
      const date = await this.getDailyDate();
      const questKey = `dailyquest_${playerId}_${date}_${type}`;

      let existingQuest;
      try {
        existingQuest = await this.client.variable.variableControllerSearch({
          filters: {
            key: [questKey],
            gameServerId: [CONFIG.gameServerId],
            playerId: [playerId],
            moduleId: [CONFIG.moduleId]
          }
        });
      } catch (err) {
        if (err?.response?.status === 401) {
          await this.authenticate();
          existingQuest = await this.client.variable.variableControllerSearch({
            filters: {
              key: [questKey],
              gameServerId: [CONFIG.gameServerId],
              playerId: [playerId],
              moduleId: [CONFIG.moduleId]
            }
          });
        } else throw err;
      }

      let questData;
      let isNewQuest = false;

      if (existingQuest?.data?.data?.length > 0) {
        const questVar = existingQuest.data.data[0];
        try { questData = JSON.parse(questVar.value || '{}'); } catch { questData = {}; }
        const prev = Number(questData.progress || 0);
        const target = Number(questData.target || prev + increment);
        questData.progress = Math.min(prev + increment, target);
        questData.completed = questData.progress >= target;
        questData.lastUpdated = new Date().toISOString();

        // If completed, enqueue for auto-claim (even if module tracker didn't)
        if (questData.completed && !questData.claimed) {
          await this.enqueueAutoClaim(playerId, date, type);
        }

        try {
          await this.client.variable.variableControllerUpdate(questVar.id, { value: JSON.stringify(questData) });
        } catch (err) {
          if (err?.response?.status === 401) {
            await this.authenticate();
            await this.client.variable.variableControllerUpdate(questVar.id, { value: JSON.stringify(questData) });
          } else throw err;
        }
      } else {
        // Create if missing for vote/levelgain so external updates never fail
        if (type === 'vote' || type === 'levelgain') {
          isNewQuest = true;
          const target = await this.getQuestTargets(type);
          questData = {
            type,
            target,
            progress: increment,
            completed: increment >= target,
            claimed: false,
            date,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          };

          // If completed immediately, enqueue for auto-claim
          if (questData.completed) {
            const playerIdForEnqueue = playerId;
            await this.enqueueAutoClaim(playerIdForEnqueue, date, type);
          }

          await this.client.variable.variableControllerCreate({
            key: questKey,
            value: JSON.stringify(questData),
            gameServerId: CONFIG.gameServerId,
            playerId,
            moduleId: CONFIG.moduleId
          });
        } else {
          return { success: false, error: 'Quest not initialized - player should use /initquests or reconnect to server' };
        }
      }

      return {
        success: true,
        questData,
        isNewQuest,
        wasCompleted: questData.completed && questData.progress === questData.target
      };
    } catch (error) {
      console.error('[Takaro] updateQuestProgress error:', error?.message || error);
      return { success: false, error: error?.message || String(error) };
    }
  }

  async sendPlayerMessage(playerName, message) {
    try {
      if (!await this.ensureAuthenticated()) throw new Error('Authentication failed');
      const safeName = String(playerName).replaceAll('"', '\\"');
      const safeMsg = String(message).replaceAll('"', '\\"');
      try {
        await this.client.gameserver.gameServerControllerExecuteCommand(CONFIG.gameServerId, {
          command: `pm "${safeName}" "${safeMsg}"`
        });
      } catch (err) {
        if (err?.response?.status === 401) {
          await this.authenticate();
          await this.client.gameserver.gameServerControllerExecuteCommand(CONFIG.gameServerId, {
            command: `pm "${safeName}" "${safeMsg}"`
          });
        } else throw err;
      }
      return true;
    } catch (error) {
      console.error('[Takaro] sendPlayerMessage error:', error?.message || error);
      return false;
    }
  }

  async handleQuestUpdate(playerName, questType, increment = 1) {
    try {
      if (!await this.ensureAuthenticated()) return { success: false, error: 'Authentication failed' };
      const playerId = await this.findPlayerByName(playerName);
      if (!playerId) return { success: false, error: 'Player not found' };

      const type = this.mapQuestType(questType);
      const result = await this.updateQuestProgress(playerId, type, increment);

      // Messaging policy (ASCII-only, avoid duplicates on completion):
      // - If new quest: notify start
      // - If in progress: show progress
      // - If completed: do NOT PM here; auto-claim will PM reward summary
      if (result.success) {
        let message = null;
        if (result.isNewQuest) {
          message = `Daily ${type} started: ${result.questData.progress}/${result.questData.target}`;
        } else if (!result.wasCompleted) {
          message = `Daily ${type}: ${result.questData.progress}/${result.questData.target}`;
        }
        if (message) await this.sendPlayerMessage(playerName, message);
      }
      return result;
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  async test() {
    if (!await this.authenticate()) return false;
    try { await this.findPlayerByName('TestPlayer'); return true; } catch { return false; }
  }
}

export default TakaroQuestClient;