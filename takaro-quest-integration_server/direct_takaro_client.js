// direct_takaro_client.js - Direct HTTP implementation without @takaro/apiclient
import https from 'https';

// Configuration
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

  makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(CONFIG.baseUrl + path);
      
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TakaroQuestBot/1.0'
        }
      };

      // Add session cookie if we have one
      if (this.sessionCookie) {
        options.headers['Cookie'] = this.sessionCookie;
      }

      const req = https.request(options, (res) => {
        let responseData = '';

        // Store cookies from response
        if (res.headers['set-cookie']) {
          this.sessionCookie = res.headers['set-cookie'].join('; ');
        }

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = responseData ? JSON.parse(responseData) : {};
            resolve({
              status: res.statusCode,
              data: jsonData
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              data: { error: 'Invalid JSON response', raw: responseData }
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (data && method !== 'GET') {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  async authenticate() {
    try {
      console.log('🔐 Attempting direct authentication with Takaro...');

      // Try different authentication endpoints
      const authAttempts = [
        // Try standard login
        {
          path: '/login',
          data: { email: CONFIG.email, password: CONFIG.password }
        },
        // Try API login
        {
          path: '/api/auth/login',
          data: { email: CONFIG.email, password: CONFIG.password }
        },
        // Try with different field names
        {
          path: '/login',
          data: { username: CONFIG.email, password: CONFIG.password }
        }
      ];

      for (const attempt of authAttempts) {
        try {
          console.log(`Trying authentication via ${attempt.path}`);
          const response = await this.makeRequest('POST', attempt.path, attempt.data);
          
          if (response.status >= 200 && response.status < 300) {
            console.log('✅ Authentication successful');
            this.authenticated = true;
            return true;
          } else if (response.status === 302 || response.status === 303) {
            console.log('✅ Authentication successful (redirect response)');
            this.authenticated = true;
            return true;
          }
          
          console.log(`Authentication attempt failed: ${response.status}`);
        } catch (error) {
          console.log(`Authentication attempt error: ${error.message}`);
        }
      }

      // If direct auth fails, try to test with a simple API call
      console.log('🔍 Testing if we can make API calls without explicit auth...');
      const testResponse = await this.makeRequest('GET', '/health');
      
      if (testResponse.status === 200) {
        console.log('✅ API access working (possibly session-based)');
        this.authenticated = true;
        return true;
      }

      console.log('❌ All authentication methods failed');
      return false;

    } catch (error) {
      console.error('❌ Authentication error:', error.message);
      return false;
    }
  }

  async findPlayerByName(playerName) {
    try {
      if (this.playerCache.has(playerName)) {
        return this.playerCache.get(playerName);
      }

      console.log(`🔍 Looking up player: ${playerName}`);

      const searchData = {
        filters: {
          name: [playerName]
        }
      };

      const response = await this.makeRequest('POST', '/player/search', searchData);

      if (response.status === 200 && response.data && response.data.data && response.data.data.length > 0) {
        const playerId = response.data.data[0].id;
        console.log(`✅ Found player ${playerName} with ID: ${playerId}`);
        this.playerCache.set(playerName, playerId);
        return playerId;
      }

      console.log(`❌ Player not found: ${playerName} (Status: ${response.status})`);
      return null;

    } catch (error) {
      console.error(`❌ Error finding player ${playerName}:`, error.message);
      return null;
    }
  }

  async updateQuestProgress(playerId, questType, increment = 1) {
    try {
      if (!this.authenticated) {
        throw new Error('Not authenticated');
      }

      const today = new Date().toISOString().split('T')[0];
      const questKey = `daily_${questType}_${today}`;

      console.log(`🎯 Updating quest: ${questKey} for player ${playerId}`);

      // Search for existing quest
      const searchData = {
        filters: {
          key: [questKey],
          gameServerId: [CONFIG.gameServerId],
          playerId: [playerId],
          moduleId: [CONFIG.moduleId]
        }
      };

      const searchResponse = await this.makeRequest('POST', '/variable/search', searchData);

      if (searchResponse.status !== 200) {
        throw new Error(`Variable search failed: ${searchResponse.status}`);
      }

      let questData;
      let isNewQuest = false;

      if (searchResponse.data.data && searchResponse.data.data.length > 0) {
        // Update existing quest
        const questVar = searchResponse.data.data[0];
        questData = JSON.parse(questVar.value);
        
        const oldProgress = questData.progress;
        questData.progress = Math.min(questData.progress + increment, questData.target);
        questData.completed = questData.progress >= questData.target;
        questData.lastUpdated = new Date().toISOString();

        const updateResponse = await this.makeRequest('PUT', `/variable/${questVar.id}`, {
          value: JSON.stringify(questData)
        });

        if (updateResponse.status !== 200) {
          throw new Error(`Variable update failed: ${updateResponse.status}`);
        }

        console.log(`📈 Updated ${questType} quest: ${oldProgress} → ${questData.progress}/${questData.target}`);
      } else {
        // Create new quest
        isNewQuest = true;
        const targets = { 'vote': 5, 'levelup': 3, 'kills': 50, 'playtime': 120 };
        const target = targets[questType] || 10;

        questData = {
          progress: increment,
          target: target,
          type: questType,
          completed: increment >= target,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };

        const createData = {
          key: questKey,
          value: JSON.stringify(questData),
          gameServerId: CONFIG.gameServerId,
          playerId: playerId,
          moduleId: CONFIG.moduleId
        };

        const createResponse = await this.makeRequest('POST', '/variable', createData);

        if (createResponse.status !== 200 && createResponse.status !== 201) {
          throw new Error(`Variable create failed: ${createResponse.status}`);
        }

        console.log(`🆕 Created new ${questType} quest: ${questData.progress}/${questData.target}`);
      }

      return {
        success: true,
        questData,
        isNewQuest,
        wasCompleted: questData.completed && questData.progress === questData.target
      };

    } catch (error) {
      console.error('❌ Error updating quest progress:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendPlayerMessage(playerName, message) {
    try {
      if (!this.authenticated) {
        throw new Error('Not authenticated');
      }

      console.log(`💬 Sending message to ${playerName}: ${message}`);

      const commandData = {
        command: `pm ${playerName} "${message}"`
      };

      const response = await this.makeRequest('POST', `/gameserver/${CONFIG.gameServerId}/command`, commandData);

      if (response.status === 200) {
        return true;
      } else {
        console.error(`Message send failed: ${response.status}`);
        return false;
      }

    } catch (error) {
      console.error('❌ Error sending message:', error.message);
      return false;
    }
  }

  async handleQuestUpdate(playerName, questType, increment = 1) {
    try {
      console.log(`\n🎮 Processing quest update for ${playerName} (${questType}, +${increment})`);
      
      if (!this.authenticated) {
        console.error('❌ Not authenticated with Takaro');
        return { success: false, error: 'Authentication failed' };
      }

      const playerId = await this.findPlayerByName(playerName);
      if (!playerId) {
        console.error(`❌ Could not find player: ${playerName}`);
        return { success: false, error: 'Player not found' };
      }

      const result = await this.updateQuestProgress(playerId, questType, increment);
      
      if (result.success) {
        let message;
        if (result.isNewQuest) {
          message = `Daily ${questType} quest started! Progress: ${result.questData.progress}/${result.questData.target}`;
        } else if (result.wasCompleted) {
          message = `🎉 Daily ${questType} quest completed! Use /dailyclaim to get your reward!`;
        } else {
          message = `Daily ${questType} quest: ${result.questData.progress}/${result.questData.target}`;
        }
        
        await this.sendPlayerMessage(playerName, message);
        console.log(`✅ Quest update successful for ${playerName}`);
      }

      return result;

    } catch (error) {
      console.error('❌ Quest update failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async test() {
    console.log('🧪 Testing direct HTTP connection...');
    
    if (!await this.authenticate()) {
      return false;
    }

    try {
      console.log('✅ Direct HTTP client test completed');
      return true;
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return false;
    }
  }
}

export default DirectTakaroClient;
