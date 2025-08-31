// working_server.js - Updated server with working Takaro integration
import express from 'express';
import TakaroQuestClient from './takaro_client.js';

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Initialize Takaro client
const questClient = new TakaroQuestClient();

// Startup sequence
async function startServer() {
  console.log('🚀 Starting Takaro Quest Integration Server...');
  console.log('=' * 50);
  
  // Test authentication on startup
  const authSuccess = await questClient.authenticate();
  if (!authSuccess) {
    console.error('❌ Failed to authenticate with Takaro on startup');
    console.error('⚠️ Server will start but quest updates may fail');
  }

  app.listen(PORT, () => {
    console.log(`✅ Quest server running on http://localhost:${PORT}`);
    console.log('📋 Available endpoints:');
    console.log('  GET  /health - Check server status');
    console.log('  GET  /test - Run connection test');
    console.log('  POST /update-quest - Update player quest');
    console.log('  POST /send-message - Send message to player');
    console.log('\nReady to receive quest updates from Python script! 🐍');
  });
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const isAuthenticated = questClient.authenticated;
  res.json({
    status: 'running',
    authenticated: isAuthenticated,
    timestamp: new Date().toISOString(),
    server: 'Takaro Quest Integration Server v1.0'
  });
});

// Test endpoint  
app.get('/test', async (req, res) => {
  console.log('🧪 Running connection test...');
  const testResult = await questClient.test();
  
  res.json({
    success: testResult,
    authenticated: questClient.authenticated,
    timestamp: new Date().toISOString(),
    message: testResult ? 'All systems operational' : 'Test failed - check logs'
  });
});

// Test quest update with a real player (for debugging)
app.post('/test-quest', async (req, res) => {
  try {
    const { playerName = 'TestPlayer', questType = 'vote' } = req.body;
    
    console.log(`🧪 Testing quest update for ${playerName} (${questType})`);
    
    const result = await questClient.handleQuestUpdate(playerName, questType, 1);
    
    res.json({
      success: result.success,
      result: result,
      timestamp: new Date().toISOString(),
      message: result.success ? 'Quest test completed' : `Quest test failed: ${result.error}`
    });
    
  } catch (error) {
    console.error('❌ Test quest error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Test quest failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Main quest update endpoint
app.post('/update-quest', async (req, res) => {
  try {
    const { playerName, questType, increment = 1 } = req.body;
    
    // Validate input
    if (!playerName || !questType) {
      return res.status(400).json({
        success: false,
        error: 'playerName and questType are required',
        timestamp: new Date().toISOString()
      });
    }

    const validQuestTypes = ['vote', 'levelup', 'kills', 'playtime'];
    if (!validQuestTypes.includes(questType)) {
      return res.status(400).json({
        success: false,
        error: `questType must be one of: ${validQuestTypes.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`\n📥 Received quest update request:`);
    console.log(`   Player: ${playerName}`);
    console.log(`   Quest: ${questType}`);
    console.log(`   Increment: ${increment}`);

    // Process the quest update
    const result = await questClient.handleQuestUpdate(playerName, questType, increment);
    
    // Send response
    res.json({
      success: result.success,
      questData: result.questData,
      error: result.error,
      playerName: playerName,
      questType: questType,
      increment: increment,
      timestamp: new Date().toISOString()
    });

    if (result.success) {
      console.log(`✅ Quest update completed successfully for ${playerName}`);
    } else {
      console.log(`❌ Quest update failed for ${playerName}: ${result.error}`);
    }

  } catch (error) {
    console.error('❌ Server error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Send message endpoint
app.post('/send-message', async (req, res) => {
  try {
    const { playerName, message } = req.body;
    
    if (!playerName || !message) {
      return res.status(400).json({
        success: false,
        error: 'playerName and message are required',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`💬 Sending message to ${playerName}: ${message}`);
    const success = await questClient.sendPlayerMessage(playerName, message);
    
    res.json({
      success,
      playerName,
      message,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Message send error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Get player info endpoint (for debugging)
app.get('/player/:playerName', async (req, res) => {
  try {
    const { playerName } = req.params;
    
    console.log(`🔍 Looking up player info: ${playerName}`);
    const playerId = await questClient.findPlayerByName(playerName);
    
    res.json({
      success: playerId !== null,
      playerName,
      playerId,
      timestamp: new Date().toISOString(),
      message: playerId ? 'Player found' : 'Player not found'
    });
    
  } catch (error) {
    console.error('❌ Player lookup error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Player lookup failed',
      timestamp: new Date().toISOString()
    });
  }
});

// List recent quest activity (if we want to add this later)
app.get('/quest-activity', async (req, res) => {
  res.json({
    message: 'Quest activity endpoint - coming soon',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down quest server gracefully...');
  console.log('👋 Goodbye!');
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
