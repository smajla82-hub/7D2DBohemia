// takaro_client.js - Core Takaro API client
import { Client } from '@takaro/apiclient';

// Configuration
const CONFIG = {
  url: 'https://api.takaro.io',
  auth: {
    username: 'smajla82@gmail.com',
    password: 'b82r03e14j23C10',
  },
  gameServerId: 'd7524118-c464-4ad9-91a0-57da9b4ad269',
  moduleId: 'ddbe24ed-58ae-4f53-899c-9a99f8029135'
};

class TakaroQuestClient {
  constructor() {
    this.client = new Client(CONFIG);
    this.authenticated = false;
    this.playerCache = new Map(); // Cache player IDs
  }

  async authenticate() {
    try {
      console.log('🔐 Authenticating with Takaro...');
      await this.client.login();
      this.authenticated = true;
      console.log('✅ Successfully authenticated with Takaro');
      return true;
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      this.authenticated = false;
      return false;
    }
  }

  async ensureAuthenticated() {
    if (!this.authenticated) {
      return await this.authenticate();
    }
    return true;
  }

  async findPlayerByName(playerName) {
    try {
      // Check cache first
      if (this.playerCache.has(playerName)) {
        return this.playerCache.get(playerName);
      }

      console.log(`🔍 Looking up player: ${playerName}`);
      
      const response = await this.client.player.playerControllerSearch({
        filters: {
          name: [playerName]
        }
      });

      if (response.data.data && response.data.data.length > 0) {
        const playerId = response.data.data[0].id;
        console.log(`✅ Found player ${playerName} with ID: ${playerId}`);
        
        // Cache the result
        this.playerCache.set(playerName, playerId);
        return playerId;
      }

      console.log(`❌ Player not found: ${playerName}`);
      return null;
    } catch (error) {
      console.error(`❌ Error finding player ${playerName}:`, error.message);
      return null;
    }
  }

  async getQuestTargets(questType) {
    const targets = {
      'vote': 5,
      'levelup': 3,
      'kills': 50,
      'playtime': 120 // minutes
    };
    return targets[questType] || 10;
  }

  async updateQuestProgress(playerId, questType, increment = 1) {
    try {
      if (!await this.ensureAuthenticated()) {
        throw new Error('Authentication failed');
      }

      const today = new Date().toISOString().split('T')[0];
      const questKey = `daily_${questType}_${today}`;

      console.log(`🎯 Updating quest: ${questKey} for player ${playerId}, increment: ${increment}`);

      // Search for existing quest variable
      const existingQuest = await this.client.variable.variableControllerSearch({
        filters: {
          key: [questKey],
          gameServerId: [CONFIG.gameServerId],
          playerId: [playerId],
          moduleId: [CONFIG.moduleId]
        }
      });

      let questData;
      let isNewQuest = false;

      if (existingQuest.data.data && existingQuest.data.data.length > 0) {
        // Update existing quest
        const questVar = existingQuest.data.data[0];
        questData = JSON.parse(questVar.value);
        
        const oldProgress = questData.progress;
        questData.progress = Math.min(questData.progress + increment, questData.target);
        questData.completed = questData.progress >= questData.target;
        questData.lastUpdated = new Date().toISOString();

        await this.client.variable.variableControllerUpdate(questVar.id, {
          value: JSON.stringify(questData)
        });

        console.log(`📈 Updated ${questType} quest: ${oldProgress} → ${questData.progress}/${questData.target}`);
      } else {
        // Create new quest
        isNewQuest = true;
        const target = await this.getQuestTargets(questType);
        questData = {
          progress: increment,
          target: target,
          type: questType,
          completed: increment >= target,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };

        await this.client.variable.variableControllerCreate({
          key: questKey,
          value: JSON.stringify(questData),
          gameServerId: CONFIG.gameServerId,
          playerId: playerId,
          moduleId: CONFIG.moduleId
        });

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
      if (!await this.ensureAuthenticated()) {
        throw new Error('Authentication failed');
      }

      console.log(`💬 Sending message to ${playerName}: ${message}`);
      
      await this.client.gameserver.gameServerControllerExecuteCommand(CONFIG.gameServerId, {
        command: `pm ${playerName} "${message}"`
      });

      return true;
    } catch (error) {
      console.error('❌ Error sending message:', error.message);
      return false;
    }
  }

  async handleQuestUpdate(playerName, questType, increment = 1) {
    try {
      console.log(`\n🎮 Processing quest update for ${playerName} (${questType}, +${increment})`);
      
      if (!await this.ensureAuthenticated()) {
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

  // Test method to verify everything works
  async test() {
    console.log('🧪 Testing Takaro connection...');
    
    if (!await this.authenticate()) {
      return false;
    }

    try {
      // Test finding a player (you might need to adjust this)
      const testPlayer = await this.findPlayerByName('TestPlayer');
      console.log('Player lookup test:', testPlayer ? '✅ Success' : '⚠️ No player found (normal if TestPlayer doesn\'t exist)');
      
      console.log('✅ Takaro client test completed');
      return true;
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return false;
    }
  }
}

export default TakaroQuestClient;
