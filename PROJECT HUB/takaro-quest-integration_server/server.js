// server.js - HTTP server for Python integration
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
    console.log('Ready to receive quest updates from Python script');
  });
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const isAuthenticated = questClient.authenticated;
  res.json({
    status: 'running',
    authenticated: isAuthenticated,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/test', async (req, res) => {
  console.log('🧪 Running connection test...');
  const testResult = await questClient.test();
  
  res.json({
    success: testResult,
    authenticated: questClient.authenticated,
    timestamp: new Date().toISOString()
  });
});

// Main quest update endpoint
app.post('/update-quest', async (req, res) => {
  try {
    const { playerName, questType, increment = 1 } = req.body;
    
    // Validate input
    if (!playerName || !questType) {
      return res.status(400).json({
        success: false,
        error: 'playerName and questType are required'
      });
    }

    // PATCH: Updated quest types to match Takaro module and Python integration
    const validQuestTypes = ['vote', 'levelgain', 'zombiekills', 'timespent', 'shopquest'];
    if (!validQuestTypes.includes(questType)) {
      return res.status(400).json({
        success: false,
        error: `questType must be one of: ${validQuestTypes.join(', ')}`
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
      timestamp: new Date().toISOString()
    });

    if (result.success) {
      console.log(`✅ Quest update completed successfully`);
    } else {
      console.log(`❌ Quest update failed: ${result.error}`);
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

// Batch quest update endpoint (for multiple updates at once)
app.post('/update-quests-batch', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'updates must be an array'
      });
    }

    console.log(`\n📥 Received batch quest update: ${updates.length} updates`);

    const results = [];
    for (const update of updates) {
      const { playerName, questType, increment = 1 } = update;
      const result = await questClient.handleQuestUpdate(playerName, questType, increment);
      results.push({
        playerName,
        questType,
        ...result
      });
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Batch completed: ${successCount}/${results.length} successful`);

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        successful: successCount,
        failed: results.length - successCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Batch update error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Send message endpoint (for custom messages)
app.post('/send-message', async (req, res) => {
  try {
    const { playerName, message } = req.body;
    
    if (!playerName || !message) {
      return res.status(400).json({
        success: false,
        error: 'playerName and message are required'
      });
    }

    console.log(`💬 Sending custom message to ${playerName}: ${message}`);
    const success = await questClient.sendPlayerMessage(playerName, message);
    
    res.json({
      success,
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
  console.log('\n🛑 Shutting down quest server...');
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
