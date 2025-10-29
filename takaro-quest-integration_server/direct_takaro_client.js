// direct_takaro_client.js - Direct HTTP implementation without @takaro/apiclient
import https from 'https';

const CONFIG = {
  baseUrl: 'https://api.takaro.io',
  email: 'smajla82@gmail.com',
  password: 'b82r03e14j23C10',
  gameServerId: 'd7524118-c464-4ad9-91a0-57da9b4ad269',
  moduleId: 'ddbe24ed-58ae-4f53-899c-9a99f8029135'
};

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
        throw new Error('Not authenticated');
      }
      const today = new Date().toISOString().split('T')[0];
      const questKey = `dailyquest_${playerId}_${today}_${questType}`;
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
      if (searchResponse.data.data && searchResponse.data.data.length > 0) {
        const questVar = searchResponse.data.data[0];
        questData = JSON.parse(questVar.value);
        questData.progress = Math.min(questData.progress + increment, questData.target);
        questData.completed = questData.progress >= questData.target;
        questData.lastUpdated = new Date().toISOString();
        let updateResponse = await this.makeRequest('PUT', `/variable/${questVar.id}`, {
          value: JSON.stringify(questData)
        });
        if (updateResponse.status === 401) {
          await this.authenticate();
          updateResponse = await this.makeRequest('PUT', `/variable/${questVar.id}`, {
            value: JSON.stringify(questData)
          });
        }
        if (updateResponse.status !== 200) {
          throw new Error(`Variable update failed: ${updateResponse.status}`);
        }
      } else {
        return {
          success: false,
          error: 'Quest not initialized - player should use /initquests or reconnect to server'
        };
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
        error: error.message
      };
    }
  }

  // ... unchanged sendPlayerMessage(), handleQuestUpdate(), test() ...

}

export default DirectTakaroClient;
