// working_server.js - Quest Integration HTTP server for the Python monitor (ASCII-only logs)
import express from 'express';
import TakaroQuestClient from './takaro_client.js';

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

const questClient = new TakaroQuestClient();

async function startServer() {
  console.log('Starting Takaro Quest Integration Server...');
  console.log('==================================================');

  // Authenticate at startup (client will also re-auth on 401)
  const authSuccess = await questClient.authenticate();
  if (!authSuccess) {
    console.error('Failed to authenticate with Takaro on startup');
    console.error('Server will start but quest updates may fail until authentication succeeds');
  }

  app.listen(PORT, () => {
    console.log(`Quest server running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  GET  /health              - Check server status');
    console.log('  GET  /test                - Run connection test');
    console.log('  POST /update-quest        - Update player quest');
    console.log('  POST /update-quests-batch - Update multiple quests');
    console.log('  POST /send-message        - Send message to player');
    console.log('Ready to receive quest updates from Python script');
  });
}

// Health check
app.get('/health', async (_req, res) => {
  res.json({
    status: 'running',
    authenticated: questClient.authenticated === true,
    timestamp: new Date().toISOString()
  });
});

// Basic client test
app.get('/test', async (_req, res) => {
  try {
    const ok = await questClient.test();
    res.json({
      success: ok,
      authenticated: questClient.authenticated,
      timestamp: new Date().toISOString(),
      message: ok ? 'All systems operational' : 'Test failed - check logs'
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e?.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
});

// Update a single quest
app.post('/update-quest', async (req, res) => {
  try {
    const { playerName, questType, increment = 1 } = req.body || {};

    if (!playerName || !questType) {
      return res.status(400).json({
        success: false,
        error: 'playerName and questType are required',
        timestamp: new Date().toISOString()
      });
    }

    console.log('Payload:', { playerName, questType, increment });

    const result = await questClient.handleQuestUpdate(String(playerName), String(questType), Number(increment) || 1);

    res.status(200).json({
      success: !!result?.success,
      questData: result?.questData ?? null,
      isNewQuest: !!result?.isNewQuest,
      wasCompleted: !!result?.wasCompleted,
      error: result?.error || '',
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error('/update-quest error:', e?.message || e);
    res.status(500).json({
      success: false,
      error: e?.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
});

// Batch quest updates
app.post('/update-quests-batch', async (req, res) => {
  try {
    const updates = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.updates) ? req.body.updates : []);
    if (!updates.length) {
      return res.status(400).json({
        success: false,
        error: 'Body must be an array of { playerName, questType, increment? } or { updates: [...] }',
        timestamp: new Date().toISOString()
      });
    }

    const results = [];
    for (const upd of updates) {
      const playerName = upd?.playerName;
      const questType = upd?.questType;
      const increment = Number(upd?.increment ?? 1) || 1;

      if (!playerName || !questType) {
        results.push({ success: false, error: 'Missing playerName or questType', input: upd });
        continue;
      }

      try {
        const r = await questClient.handleQuestUpdate(String(playerName), String(questType), increment);
        results.push({ success: !!r?.success, questData: r?.questData ?? null, error: r?.error || '' });
      } catch (e) {
        results.push({ success: false, error: e?.message || String(e) });
      }
    }

    res.json({ success: true, results, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('/update-quests-batch error:', e?.message || e);
    res.status(500).json({
      success: false,
      error: e?.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
});

// Send a message to a player
app.post('/send-message', async (req, res) => {
  try {
    const { playerName, message } = req.body || {};
    if (!playerName || !message) {
      return res.status(400).json({
        success: false,
        error: 'playerName and message are required',
        timestamp: new Date().toISOString()
      });
    }

    const ok = await questClient.sendPlayerMessage(String(playerName), String(message));
    res.json({
      success: !!ok,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('/send-message error:', e?.message || e);
    res.status(500).json({
      success: false,
      error: e?.message || String(e),
      timestamp: new Date().toISOString()
    });
  }
});

startServer().catch((e) => {
  console.error('Startup error:', e?.message || e);
  process.exitCode = 1;
});