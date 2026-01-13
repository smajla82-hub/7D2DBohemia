// direct_takaro_client.js - Direct HTTP implementation without @takaro/apiclient
import https from 'https';

const CONFIG = {
  baseUrl: 'https://api.takaro.io',
  email: 'smajla82@gmail.com',
  password: 'b82r03e14j23C10',
  gameServerId: 'd7524118-c464-4ad9-91a0-57da9b4ad269',
  moduleId: 'ddbe24ed-58ae-4f53-899c-9a99f8029135'
};
// --- Daily key helpers (Europe/Prague) ---
const TIME_ZONE = 'Europe/Prague';

function pragueToday() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  return d.toISOString().split('T')[0]; // YYYY-MM-DD for Prague local day
}

function startOfTodayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function defaultTarget(type) {
  const map = {
    vote: 1,
    levelgain: 5,
    zombiekills: 200,
    feralkills: 10,
    vulturekills: 10,
    timespent: 3600000,
    unkillable: 10800000,
    shopquest: 1,
    dieonce: 1
  };
  return map[type] ?? 1;
}

class DirectTakaroClient {
  constructor() {
    this.authenticated = false;
    this.sessionCookie = null;
    this.playerCache = new Map();
  }

  // ... unchanged authenticate() and makeRequest() methods ...

  async findPlayerByName(playerName) {
    try {
      if (this.playerCache.has(playerName)) {
        return this.playerCache.get(playerName);
      }
      const searchData = { filters: { name: [playerName] } };
      let response = await this.makeRequest('POST', '/player/search', searchData);
      if (response.status === 401) {
        // Session expired, re-authenticate and retry
        await this.authenticate();
        response = await this.makeRequest('POST', '/player/search', searchData);
      }
      if (response.status === 200 && response.data && response.data.data && response.data.data.length > 0) {
        const playerId = response.data.data[0].id;
        this.playerCache.set(playerName, playerId);
        return playerId;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

   async updateQuestProgress(playerId, questType, increment = 1) {
    try {
      if (!this.authenticated) {
        // If your class already has ensureAuthenticated(), call that instead
        await this.authenticate();
        if (!this.authenticated) throw new Error('Not authenticated');
      }

      // 1) Compute today in Europe/Prague
      const today = pragueToday();
      const questKey = `dailyquest_${playerId}_${today}_${questType}`;

      // 2) Try to find today's variable (singular search API your file already uses)
      const searchData = {
        filters: {
          key: [questKey],
          gameServerId: [CONFIG.gameServerId],
          playerId: [playerId],
          moduleId: [CONFIG.moduleId]
        }
      };
      let searchResponse = await this.makeRequest('POST', '/variable/search', searchData);
      if (searchResponse.status === 401) {
        await this.authenticate();
        searchResponse = await this.makeRequest('POST', '/variable/search', searchData);
      }

      let questData;
      let isNewQuest = false;

      if (searchResponse.status !== 200) {
        // If your backend sometimes expects /variables/search, try it as fallback
        searchResponse = await this.makeRequest('POST', '/variables/search', searchData);
      }

      const found = (searchResponse?.data?.data || []);
      if (found.length > 0) {
        // 3) Update existing today's quest
        const questVar = found[0];
        try {
          questData = JSON.parse(questVar.value);
        } catch {
          questData = {
            type: questType,
            target: defaultTarget(questType),
            progress: 0,
            completed: false,
            claimed: false,
            date: today,
            createdAt: startOfTodayISO()
          };
          isNewQuest = true;
        }

        // If the stored object says an old date (rare), reset for today
        if (questData.date !== today) {
          questData.progress = 0;
          questData.completed = false;
          questData.claimed = false;
          questData.date = today;
          questData.createdAt = startOfTodayISO();
        }

        questData.type = questType;
        questData.target = questData.target ?? defaultTarget(questType);
        questData.progress = Math.min((questData.progress ?? 0) + Number(increment || 1), questData.target);
        questData.completed = questData.progress >= questData.target;
        questData.lastUpdated = new Date().toISOString();

        let updateResp = await this.makeRequest('PUT', `/variable/${questVar.id}`, {
          value: JSON.stringify(questData)
        });
        if (updateResp.status === 401) {
          await this.authenticate();
          updateResp = await this.makeRequest('PUT', `/variable/${questVar.id}`, {
            value: JSON.stringify(questData)
          });
        }
        if (updateResp.status !== 200) {
          throw new Error(`Variable update failed: ${updateResp.status}`);
        }
      } else {
        // 4) Not found - attempt to migrate same-day stale keys
        // Fetch player+module variables and look for wrong-date key for this type created today
        const broadSearch = {
          filters: {
            gameServerId: [CONFIG.gameServerId],
            playerId: [playerId],
            moduleId: [CONFIG.moduleId]
          }
        };
        let broadResp = await this.makeRequest('POST', '/variable/search', broadSearch);
        if (broadResp.status === 401) {
          await this.authenticate();
          broadResp = await this.makeRequest('POST', '/variable/search', broadSearch);
        }
        let migrated = false;
        const allVars = (broadResp?.data?.data || []);
        const todayStart = new Date(startOfTodayISO());

        for (const v of allVars) {
          try {
            if (!v?.key?.startsWith(`dailyquest_${playerId}_`)) continue;
            if (!v.key.endsWith(`_${questType}`)) continue;
            if (v.key.includes(`_${today}_`)) continue; // already today
            const val = JSON.parse(v.value);
            const createdAt = new Date(val.createdAt || v.createdAt);
            if (createdAt >= todayStart) {
              // Migrate progress into today's correct key
              questData = {
                type: questType,
                target: val.target ?? defaultTarget(questType),
                progress: (val.progress ?? 0) + Number(increment || 1),
                completed: false,
                claimed: val.claimed ?? false,
                date: today,
                createdAt: startOfTodayISO(),
                lastUpdated: new Date().toISOString()
              };
              questData.completed = questData.progress >= questData.target;

              // Try modern plural create first; if 404, fallback to singular
              let createResp = await this.makeRequest('POST', '/variables', {
                key: questKey,
                value: JSON.stringify(questData),
                gameServerId: CONFIG.gameServerId,
                playerId,
                moduleId: CONFIG.moduleId
              });
              if (createResp.status === 401) {
                await this.authenticate();
                createResp = await this.makeRequest('POST', '/variables', {
                  key: questKey,
                  value: JSON.stringify(questData),
                  gameServerId: CONFIG.gameServerId,
                  playerId,
                  moduleId: CONFIG.moduleId
                });
              }
              if (createResp.status !== 200 && createResp.status !== 201) {
                // fallback to singular endpoint some installs use
                createResp = await this.makeRequest('POST', '/variable', {
                  key: questKey,
                  value: JSON.stringify(questData),
                  gameServerId: CONFIG.gameServerId,
                  playerId,
                  moduleId: CONFIG.moduleId
                });
                if (createResp.status !== 200 && createResp.status !== 201) {
                  throw new Error(`Variable create failed: ${createResp.status}`);
                }
              }
              migrated = true;
              isNewQuest = true;
              break; // stop after first good migration
            }
          } catch {
            // ignore bad JSON values
          }
        }

        if (!migrated) {
          // 5) Create fresh today's key (idempotent upsert)
          questData = {
            type: questType,
            target: defaultTarget(questType),
            progress: Number(increment || 1),
            completed: false,
            claimed: false,
            date: today,
            createdAt: startOfTodayISO(),
            lastUpdated: new Date().toISOString()
          };
          questData.completed = questData.progress >= questData.target;

          let createResp = await this.makeRequest('POST', '/variables', {
            key: questKey,
            value: JSON.stringify(questData),
            gameServerId: CONFIG.gameServerId,
            playerId,
            moduleId: CONFIG.moduleId
          });
          if (createResp.status === 401) {
            await this.authenticate();
            createResp = await this.makeRequest('POST', '/variables', {
              key: questKey,
              value: JSON.stringify(questData),
              gameServerId: CONFIG.gameServerId,
              playerId,
              moduleId: CONFIG.moduleId
            });
          }
          if (createResp.status !== 200 && createResp.status !== 201) {
            // fallback to singular endpoint some installs use
            createResp = await this.makeRequest('POST', '/variable', {
              key: questKey,
              value: JSON.stringify(questData),
              gameServerId: CONFIG.gameServerId,
              playerId,
              moduleId: CONFIG.moduleId
            });
            if (createResp.status !== 200 && createResp.status !== 201) {
              throw new Error(`Variable create failed: ${createResp.status}`);
            }
          }
          isNewQuest = true;
        }
      }

      return {
        success: true,
        questData,
        isNewQuest,
        wasCompleted: questData.completed && questData.progress === questData.target
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || String(error)
      };
    }
  }

export default DirectTakaroClient;
