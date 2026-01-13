// working_server.js - v15.4 server with mismatch scan/fix endpoints
import express from 'express';
import TakaroQuestClient from './takaro_client.js';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

const questClient = new TakaroQuestClient();

// Existing endpoints
app.get('/health', (_req, res) => {
  res.json({
    status: 'running',
    authenticated: questClient.authenticated === true,
    version: questClient.version,
    timestamp: new Date().toISOString()
  });
});

app.get('/test', async (_req, res) => {
  try {
    const ok = await questClient.test();
    res.json({
      success: ok,
      authenticated: questClient.authenticated,
      version: questClient.version,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/update-quest', async (req, res) => {
  try {
    const { playerName, questType, increment = 1 } = req.body || {};
    if (!playerName || !questType) {
      return res.status(400).json({ success: false, error: 'playerName and questType required' });
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
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/update-quests-batch', async (req, res) => {
  try {
    const updates = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.updates) ? req.body.updates : []);
    if (!updates.length) return res.status(400).json({ success: false, error: 'Provide an array of updates' });
    const results = [];
    for (const upd of updates) {
      const { playerName, questType } = upd || {};
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
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.post('/send-message', async (req, res) => {
  try {
    const { playerName, message } = req.body || {};
    if (!playerName || !message) return res.status(400).json({ success: false, error: 'playerName and message required' });
    const ok = await questClient.sendPlayerMessage(String(playerName), String(message));
    res.json({ success: !!ok, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// Debug quest
app.get('/debug/quest', async (req, res) => {
  try {
    const playerName = req.query.playerName;
    const type = req.query.type || 'levelgain';
    if (!playerName) return res.status(400).json({ ok: false, error: 'Missing playerName' });
    const data = await questClient.getQuestVarByName(playerName, type);
    res.status(200).json({ ok: true, data, version: questClient.version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// NEW: Scan all today’s quests for a player
app.get('/debug/scan-today', async (req, res) => {
  try {
    const playerName = req.query.playerName;
    if (!playerName) return res.status(400).json({ ok: false, error: 'Missing playerName' });
    const playerId = await questClient.getPlayerIdByName(playerName);
    if (!playerId) return res.status(404).json({ ok: false, error: 'Player not found' });
    const scan = await questClient.scanTodayPlayerQuests(playerId);
    res.json({ ok: true, playerId, quests: scan.quests, version: questClient.version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// NEW: Fix mismatches with optional explicit repairs
app.post('/debug/fix-mismatches', async (req, res) => {
  try {
    const { playerName, repairs = [] } = req.body || {};
    if (!playerName) return res.status(400).json({ ok: false, error: 'Missing playerName' });
    const playerId = await questClient.getPlayerIdByName(playerName);
    if (!playerId) return res.status(404).json({ ok: false, error: 'Player not found' });

    const scan = await questClient.scanTodayPlayerQuests(playerId);
    const results = [];
    // Automatically fix mismatches not explicitly listed if no repairs provided for them
    const repairMap = new Map(repairs.map(r => [r.questType, r]));
    for (const q of scan.quests) {
      if (!q.mismatch && !repairMap.has(q.keySuffix)) continue;
      const rData = repairMap.get(q.keySuffix) || {};
      const rep = await questClient.repairQuest(playerId, q.keySuffix, {
        progress: rData.progress,
        target: rData.target,
        claimed: rData.claimed,
        completed: rData.completed
      });
      results.push(rep);
    }
    res.json({ ok: true, playerId, fixes: results, version: questClient.version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// NEW: Direct manual set
app.post('/debug/set-quest', async (req, res) => {
  try {
    const { playerName, questType, progress, target, completed, claimed } = req.body || {};
    if (!playerName || !questType) return res.status(400).json({ ok: false, error: 'playerName and questType required' });
    const playerId = await questClient.getPlayerIdByName(playerName);
    if (!playerId) return res.status(404).json({ ok: false, error: 'Player not found' });
    const out = await questClient.setQuest(playerId, questType, { progress, target, completed, claimed });
    res.json({ ok: true, result: out, version: questClient.version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

async function startServer() {
  console.log('Starting Takaro Quest Integration Server...');
  console.log('==================================================');
  const authSuccess = await questClient.authenticate();
  if (!authSuccess) {
    console.error('Failed to authenticate with Takaro on startup');
    console.error('Server will start but quest updates may fail until authentication succeeds');
  }
  app.listen(PORT, () => {
    console.log(`Quest server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  GET  /test');
    console.log('  POST /update-quest');
    console.log('  POST /update-quests-batch');
    console.log('  POST /send-message');
    console.log('  GET  /debug/quest');
    console.log('  GET  /debug/scan-today');
    console.log('  POST /debug/fix-mismatches');
    console.log('  POST /debug/set-quest');
  });
}

process.on('unhandledRejection', err => {
  console.error('UnhandledRejection:', err?.message || String(err));
});

startServer().catch(e => {
  console.error('Startup error:', e?.message || e);
  process.exitCode = 1;
});