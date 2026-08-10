// working_server.js - v15.7 server (uses direct_takaro_client.mjs)
// Adds support for non-Steam players by allowing identityHint:
// - steamId (legacy)
// - platform + platformId (new): platform in ["steam","xbl","eos"]

import express from 'express';
import TakaroQuestClient from './direct_takaro_client.mjs';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

const questClient = new TakaroQuestClient();

async function startupAuth() {
  try {
    // Keep compatibility with older/newer client versions
    if (typeof questClient.ensureAuthenticated === 'function') {
      await questClient.ensureAuthenticated();
    } else if (typeof questClient.initAuth === 'function') {
      await questClient.initAuth();
    } else if (typeof questClient.authenticate === 'function') {
      await questClient.authenticate();
    }
  } catch (e) {
    console.error('Failed to authenticate with Takaro on startup');
    console.error('Server will start but quest updates may fail until authentication succeeds');
    console.error('Startup auth error:', e?.message || e);
  }
}

console.log('Starting Takaro Quest Integration Server...');
console.log('==================================================');
console.log(`Takaro client version: ${questClient.version || 'unknown'}`);

await startupAuth();

app.get('/health', (_req, res) => {
  res.json({
    status: 'running',
    authenticated: questClient.authenticated === true,
    version: questClient.version,
    timestamp: new Date().toISOString()
  });
});

// Extra endpoint to verify which code is actually running
app.get('/debug/version', (_req, res) => {
  res.json({
    ok: true,
    server: 'working_server.js v15.7',
    clientVersion: questClient.version || null,
    authenticated: questClient.authenticated === true,
    timestamp: new Date().toISOString()
  });
});

app.get('/test', async (_req, res) => {
  try {
    const ok = await questClient.test();
    res.json({
      success: ok,
      authenticated: questClient.authenticated === true,
      version: questClient.version,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/update-quest', async (req, res) => {
  try {
    const { playerName, steamId, questType, increment, platform, platformId } = req.body || {};
    console.log('Payload:', { playerName, steamId, questType, increment, platform, platformId });

    if (!playerName || !questType) {
      return res.status(400).json({ success: false, error: 'playerName and questType required' });
    }

    const inc = Number.isFinite(Number(increment)) ? Number(increment) : 1;

    // identityHint priority: steamId -> platform+platformId -> null (fallback to name)
    const identityHint =
      (steamId ? { kind: 'steam', value: String(steamId) } : null) ||
      (platform && platformId ? { kind: String(platform).toLowerCase(), value: String(platformId) } : null) ||
      null;

    const result = await questClient.handleQuestUpdate(playerName, questType, inc, identityHint);

    if (!result?.success) {
      return res.status(200).json({ success: false, error: result?.error || 'Quest update failed' });
    }

    return res.json({
      success: true,
      questData: result.questData || null,
      wasCompleted: !!result.wasCompleted,
      isNewQuest: !!result.isNewQuest
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/update-quests-batch', async (req, res) => {
  try {
    const { updates } = req.body || {};
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'updates must be an array' });
    }

    const results = [];
    for (const u of updates) {
      const playerName = u?.playerName;
      const questType = u?.questType;
      const inc = Number.isFinite(Number(u?.increment)) ? Number(u.increment) : 1;

      if (!playerName || !questType) {
        results.push({ success: false, error: 'playerName and questType required', input: u });
        continue;
      }

      const steamId = u?.steamId || null;
      const platform = u?.platform || null;
      const platformId = u?.platformId || null;

      const identityHint =
        (steamId ? { kind: 'steam', value: String(steamId) } : null) ||
        (platform && platformId ? { kind: String(platform).toLowerCase(), value: String(platformId) } : null) ||
        null;

      try {
        const r = await questClient.handleQuestUpdate(playerName, questType, inc, identityHint);
        results.push(r);
      } catch (e) {
        results.push({ success: false, error: e?.message || String(e), input: u });
      }
    }

    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/send-message', async (req, res) => {
  try {
    const { playerName, message } = req.body || {};
    if (!playerName || !message) {
      return res.status(400).json({ success: false, error: 'playerName and message required' });
    }
    const ok = await questClient.sendPlayerMessage(playerName, message);
    res.json({ success: ok });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// Existing debug endpoints unchanged
app.get('/debug/quest', async (req, res) => {
  try {
    const playerName = req.query.playerName;
    const questType = req.query.questType;
    if (!playerName || !questType) {
      return res.status(400).json({ success: false, error: 'playerName and questType query params required' });
    }
    const r = await questClient.getQuestVarByName(playerName, questType);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.get('/debug/scan-today', async (req, res) => {
  try {
    const playerId = req.query.playerId;
    if (!playerId) return res.status(400).json({ success: false, error: 'playerId query param required' });
    const r = await questClient.scanTodayPlayerQuests(String(playerId));
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/debug/fix-mismatches', async (req, res) => {
  try {
    const { playerId } = req.body || {};
    if (!playerId) return res.status(400).json({ success: false, error: 'playerId required' });

    const scan = await questClient.scanTodayPlayerQuests(String(playerId));
    if (!scan?.ok) return res.status(200).json({ success: false, error: scan?.error || 'scan failed' });

    const mismatches = (scan.quests || []).filter(q => q.mismatch);
    const fixed = [];

    for (const q of mismatches) {
      const r = await questClient.repairQuest(String(playerId), q.keySuffix, {
        progress: q.progress,
        target: q.target,
        claimed: q.claimed,
        completed: q.completed
      });
      fixed.push({ quest: q, result: r });
    }

    res.json({ success: true, mismatches: mismatches.length, fixed });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/debug/set-quest', async (req, res) => {
  try {
    const { playerId, questType, progress, target, completed, claimed } = req.body || {};
    if (!playerId || !questType) {
      return res.status(400).json({ success: false, error: 'playerId and questType required' });
    }
    const r = await questClient.setQuest(String(playerId), questType, { progress, target, completed, claimed });
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Quest server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /debug/version');
  console.log('  GET  /test');
  console.log('  POST /update-quest');
  console.log('  POST /update-quests-batch');
  console.log('  POST /send-message');
  console.log('  GET  /debug/quest');
  console.log('  GET  /debug/scan-today');
  console.log('  POST /debug/fix-mismatches');
  console.log('  POST /debug/set-quest');
});