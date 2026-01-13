/**
 * Takaro Quest Integration Client - v15.4
 * Adds mismatch scanning & fixing utilities.
 * New methods:
 *   scanTodayPlayerQuests(playerId)
 *   repairQuest(playerId, questType, { progress, target, claimed, completed })
 * Maintains strict key selection (v15.3).
 */

import http from 'http';
import https from 'https';

const VERSION = 'v15.4';

const CONFIG = {
  baseUrl: process.env.TAKARO_BASE_URL || 'https://api.takaro.io',
  email: process.env.TAKARO_EMAIL || 'smajla82@gmail.com',
  password: process.env.TAKARO_PASSWORD || 'b82r03e14j23C10',
  gameServerId: process.env.TAKARO_GAMESERVER_ID || 'd7524118-c464-4ad9-91a0-57da9b4ad269',
  moduleId: process.env.TAKARO_MODULE_ID || 'ddbe24ed-58ae-4f53-899c-9a99f8029135',
  domainId: process.env.TAKARO_DOMAIN_ID || 'breezy-crews-fly',
  authMode: (process.env.TAKARO_AUTH_MODE || 'auto').toLowerCase(),
  basicUser: process.env.TAKARO_BASIC_USER || '',
  basicPass: process.env.TAKARO_BASIC_PASS || '',
  bearerToken: process.env.TAKARO_BEARER_TOKEN || '',
  adminToken: process.env.TAKARO_ADMIN_TOKEN || '',
  cookieOverride: process.env.TAKARO_COOKIE || ''
};

const TIME_ZONE = 'Europe/Prague';
function pragueToday() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  return d.toISOString().split('T')[0];
}
function startOfTodayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function defaultTarget(type) {
  const map = {
    vote: 1, levelgain: 5, zombiekills: 200, feralkills: 10,
    vulturekills: 10, timespent: 3600000, unkillable: 10800000,
    shopquest: 1, dieonce: 1, tradebeers: 1
  };
  return map[type] ?? 1;
}
function mapQuestType(t) {
  const m = {
    levelup: 'levelgain', levelgain: 'levelgain', vote: 'vote',
    zombiekills: 'zombiekills', feralkills: 'feralkills',
    vulturekills: 'vulturekills', timespent: 'timespent',
    unkillable: 'unkillable', shopquest: 'shopquest',
    dieonce: 'dieonce', tradebeers: 'tradebeers'
  };
  return m[String(t || '').toLowerCase()] || t;
}
function unpackArray(resp) {
  if (!resp) return [];
  const root = resp.data;
  if (Array.isArray(root)) return root;
  const d = root?.data ?? root;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d?.results)) return d.results;
  if (Array.isArray(root?.results)) return root.results;
  return [];
}

const PATH_PREFIXES = ['', '/api', '/v1', '/api/v1'];
const pathCache = new Map();

class TakaroQuestClientV154 {
  constructor() {
    this.version = VERSION;
    this.cookieJar = '';
    this.authenticated = false;
    this.playerCache = new Map();
    this.authStrategyChosen = null;
  }
  log(...a) { console.log('[TAKARO v15.4]', ...a); }

  async initAuth() {
    if (this.authenticated) return true;
    if (CONFIG.cookieOverride) {
      this.cookieJar = CONFIG.cookieOverride;
      this.authenticated = true;
      this.authStrategyChosen = 'cookieOverride';
      this.log('Using cookie override.');
      return true;
    }
    if (CONFIG.adminToken) {
      this.log('Attempt admin token mint for domain:', CONFIG.domainId);
      const resp = await this.requestRaw('POST', '/token', { domainId: CONFIG.domainId }, {
        'X-Takaro-Admin-Token': CONFIG.adminToken
      });
      if (resp.status === 200) {
        const token = resp?.data?.data?.token;
        if (token) {
          this.cookieJar = `takaro-token=${token}; takaro-domain=${CONFIG.domainId}`;
          this.authenticated = true;
          this.authStrategyChosen = 'adminMint';
          this.log('Admin mint successful.');
          return true;
        }
      }
      this.log('Admin mint failed status:', resp.status);
    }
    if (CONFIG.authMode === 'basic' ||
       (CONFIG.authMode === 'auto' && CONFIG.basicUser && CONFIG.basicPass)) {
      this.authenticated = true;
      this.authStrategyChosen = 'basic';
      this.log('Using basic auth strategy.');
      return true;
    }
    if (CONFIG.authMode === 'bearer' || (CONFIG.authMode === 'auto' && CONFIG.bearerToken)) {
      if (CONFIG.bearerToken) {
        this.authenticated = true;
        this.authStrategyChosen = 'bearer';
        this.log('Using bearer token strategy.');
        return true;
      }
    }
    if (CONFIG.authMode === 'login' || CONFIG.authMode === 'auto') {
      this.log('Attempting /login fallback auth.');
      const resp = await this.requestRaw('POST', '/login', {
        username: CONFIG.email, password: CONFIG.password
      });
      if (resp.status === 200) {
        const token = resp?.data?.data?.token ?? resp?.data?.token;
        let cookies = '';
        if (Array.isArray(resp.headers['set-cookie']) && resp.headers['set-cookie'].length) {
          cookies = resp.headers['set-cookie']
            .map(c => String(c).split(';')[0].trim())
            .filter(Boolean)
            .join('; ');
        }
        if (token && !cookies.includes('takaro-token=')) {
          cookies = [cookies, `takaro-token=${token}`].filter(Boolean).join('; ');
        }
        if (cookies) {
          this.cookieJar = cookies;
          this.authenticated = true;
          this.authStrategyChosen = 'login';
          this.log('Login fallback succeeded; cookies set.');
          return true;
        }
      }
      this.log('Login fallback failed status:', resp.status);
    }
    this.log('No auth method succeeded.');
    return false;
  }
  async authenticate() { this.log('Legacy authenticate() called; delegating to initAuth()'); return this.initAuth(); }
  async ensureAuthenticated() { return this.initAuth(); }

  requestRaw(method, path, data = null, extraHeaders = {}) {
    return new Promise((resolve) => {
      const url = new URL(path.startsWith('http') ? path : CONFIG.baseUrl + path);
      const body = data ? JSON.stringify(data) : null;
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...extraHeaders };
      if (this.cookieJar) headers['Cookie'] = this.cookieJar;
      if (this.authStrategyChosen === 'basic') {
        const b64 = Buffer.from(`${CONFIG.basicUser}:${CONFIG.basicPass}`).toString('base64');
        headers['Authorization'] = `Basic ${b64}`;
      } else if (this.authStrategyChosen === 'bearer') {
        headers['Authorization'] = `Bearer ${CONFIG.bearerToken}`;
      } else if (['adminMint','login'].includes(this.authStrategyChosen)) {
        const tokenMatch = /takaro-token=([^;]+)/.exec(this.cookieJar);
        if (tokenMatch) headers['Authorization'] = `Bearer ${tokenMatch[1]}`;
      }
      if (body) headers['Content-Length'] = Buffer.byteLength(body);
      const options = {
        method, hostname: url.hostname, path: url.pathname + (url.search || ''),
        port: url.port || (isHttps ? 443 : 80), headers, agent: new mod.Agent({ keepAlive: true })
      };
      const req = mod.request(options, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      });
      req.on('error', err => resolve({ status: 599, data: { error: err.message }, headers: {} }));
      if (body) req.write(body);
      req.end();
    });
  }

  async requestWithFallback(method, cacheKey, suffix, data = null) {
    if (pathCache.has(cacheKey)) return this.requestRaw(method, pathCache.get(cacheKey), data);
    for (const prefix of PATH_PREFIXES) {
      const full = `${prefix}${suffix}`;
      const resp = await this.requestRaw(method, full, data);
      if (resp.status >= 200 && resp.status < 300) {
        pathCache.set(cacheKey, full);
        return resp;
      }
    }
    const last = `${PATH_PREFIXES[PATH_PREFIXES.length - 1]}${suffix}`;
    return this.requestRaw(method, last, data);
  }

  async findPlayerByName(name) {
    if (this.playerCache.has(name)) return this.playerCache.get(name);
    if (!await this.initAuth()) return null;

    let r = await this.requestWithFallback('POST', 'player_search_exact', '/player/search', {
      filters: { name: [name] }, limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) { this.playerCache.set(name, a[0].id); return a[0].id; }
    }
    r = await this.requestWithFallback('POST', 'player_search_partial', '/player/search', {
      search: { name: [name] }, limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) { this.playerCache.set(name, a[0].id); return a[0].id; }
    }
    r = await this.requestWithFallback('POST', 'gameserver_player_search', '/gameserver/player/search', {
      filters: { gameServerId: [CONFIG.gameServerId] }, search: { name: [name] }, extend: ['player'], limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) return a[0]?.playerId || a[0]?.player?.id || null;
    }
    return null;
  }

  async getPlayerIdByName(name) { return this.findPlayerByName(name); }

  async getQuestVarByName(playerName, rawType) {
    const playerId = await this.getPlayerIdByName(playerName);
    if (!playerId) return { ok: false, error: 'Player not found' };
    const type = mapQuestType(rawType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${type}`;
    const payload = {
      filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] },
      limit: 3
    };
    const resp = await this.requestWithFallback('POST', 'variables_search_debug', '/variables/search', payload);
    const arr = unpackArray(resp);
    const row = arr.find(v => v.key === key) || null;
    let parsed = null;
    if (row) { try { parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; } catch { parsed = row.value; } }
    return { ok: true, playerId, key, row, value: parsed };
  }

  // Scan today's quests for mismatches (type vs key suffix)
  async scanTodayPlayerQuests(playerId) {
    if (!await this.initAuth()) return { ok: false, error: 'Auth failed' };
    const today = pragueToday();
    const prefix = `dailyquest_${playerId}_${today}_`;
    const payload = {
      filters: {
        gameServerId: [CONFIG.gameServerId],
        playerId: [playerId],
        moduleId: [CONFIG.moduleId]
      },
      limit: 200
    };
    const resp = await this.requestWithFallback('POST', 'variables_search_all', '/variables/search', payload);
    const all = unpackArray(resp);
    const quests = [];
    for (const v of all) {
      if (!v.key?.startsWith(prefix)) continue;
      const suffix = v.key.substring(prefix.length);
      let val;
      try { val = typeof v.value === 'string' ? JSON.parse(v.value) : v.value; } catch { val = v.value; }
      const storedType = val?.type || null;
      quests.push({
        id: v.id,
        key: v.key,
        keySuffix: suffix,
        storedType,
        mismatch: storedType && storedType !== suffix,
        progress: val?.progress ?? null,
        target: val?.target ?? null,
        completed: !!val?.completed,
        claimed: !!val?.claimed,
        raw: val
      });
    }
    return { ok: true, quests };
  }

  async repairQuest(playerId, questType, { progress, target, claimed, completed } = {}) {
    if (!await this.initAuth()) return { ok: false, error: 'Auth failed' };
    const type = mapQuestType(questType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${type}`;
    const payload = {
      filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] },
      limit: 5
    };
    let resp = await this.requestWithFallback('POST', 'variables_search_repair', '/variables/search', payload);
    if (resp.status !== 200) resp = await this.requestWithFallback('POST', 'variable_search_repair', '/variable/search', payload);
    const arr = unpackArray(resp);
    const row = arr.find(v => v.key === key);
    if (!row) return { ok: false, error: 'Key not found for repair', key };

    let val;
    try { val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; } catch { val = {}; }

    val.type = type;
    val.target = target != null ? target : defaultTarget(type);
    if (progress != null) val.progress = progress;
    else if (val.progress == null) val.progress = 0;
    val.completed = completed != null ? completed : (val.progress >= val.target);
    val.claimed = claimed != null ? claimed : val.claimed || false;
    val.date = today;
    val.lastUpdated = new Date().toISOString();
    if (!val.createdAt) val.createdAt = startOfTodayISO();

    const updateResp = await this.requestWithFallback('PUT', 'variables_update_repair', `/variables/${row.id}`, {
      value: JSON.stringify(val)
    });
    if (updateResp.status !== 200) return { ok: false, error: `PUT failed ${updateResp.status}` };
    return { ok: true, key, value: val };
  }

  async setQuest(playerId, questType, { progress, target, completed, claimed } = {}) {
    if (!await this.initAuth()) return { ok: false, error: 'Auth failed' };
    const type = mapQuestType(questType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${type}`;
    const payload = {
      filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] },
      limit: 3
    };
    let searchResp = await this.requestWithFallback('POST', 'variables_search_set', '/variables/search', payload);
    const arr = unpackArray(searchResp);
    const row = arr.find(v => v.key === key);
    const val = {
      type,
      target: target != null ? target : defaultTarget(type),
      progress: progress != null ? progress : 0,
      completed: completed != null ? completed : (progress != null ? progress >= (target != null ? target : defaultTarget(type)) : false),
      claimed: claimed != null ? claimed : false,
      date: today,
      createdAt: startOfTodayISO(),
      lastUpdated: new Date().toISOString()
    };
    if (row) {
      const putResp = await this.requestWithFallback('PUT', 'variables_update_set', `/variables/${row.id}`, {
        value: JSON.stringify(val)
      });
      if (putResp.status !== 200) return { ok: false, error: `PUT failed ${putResp.status}` };
      return { ok: true, action: 'updated', key, value: val };
    } else {
      let createResp = await this.requestWithFallback('POST', 'variables_create_set', '/variables', {
        key, value: JSON.stringify(val), gameServerId: CONFIG.gameServerId, playerId, moduleId: CONFIG.moduleId
      });
      if (![200,201].includes(createResp.status)) {
        createResp = await this.requestWithFallback('POST', 'variable_create_set', '/variable', {
          key, value: JSON.stringify(val), gameServerId: CONFIG.gameServerId, playerId, moduleId: CONFIG.moduleId
        });
        if (![200,201].includes(createResp.status)) return { ok: false, error: `Create failed ${createResp.status}` };
      }
      return { ok: true, action: 'created', key, value: val };
    }
  }

  // Existing quest update (strict key selection)
  async updateQuestProgress(playerId, rawType, inc = 1) {
    if (!await this.initAuth()) return { success: false, error: 'Not authenticated' };
    const questType = mapQuestType(rawType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${questType}`;

    const searchPayload = {
      filters: { key: [key], gameServerId: [CONFIG.gameServerId], playerId: [playerId], moduleId: [CONFIG.moduleId] },
      limit: 5
    };
    let searchResp = await this.requestWithFallback('POST', 'variables_search', '/variables/search', searchPayload);
    if (searchResp.status !== 200) {
      searchResp = await this.requestWithFallback('POST', 'variable_search', '/variable/search', searchPayload);
    }
    const results = unpackArray(searchResp) || [];
    const questVar = results.find(v =>
      v?.key === key &&
      v?.playerId === playerId &&
      v?.gameServerId === CONFIG.gameServerId &&
      v?.moduleId === CONFIG.moduleId
    );

    let data; let isNew = false;
    if (questVar) {
      try { data = typeof questVar.value === 'string' ? JSON.parse(questVar.value) : questVar.value; } catch { data = null; }
      if (!data) {
        data = { type: questType, target: defaultTarget(questType), progress: 0, completed: false, claimed: false, date: today, createdAt: startOfTodayISO() };
        isNew = true;
      }
      if (data.date !== today) {
        data.progress = 0; data.completed = false; data.claimed = false; data.date = today; data.createdAt = startOfTodayISO();
      }
      data.type = questType;
      data.target = data.target ?? defaultTarget(questType);
      data.progress = Math.min((data.progress ?? 0) + Number(inc || 1), data.target);
      const nowCompleted = data.progress >= data.target;
      const wasCompletedBefore = !!data.completed;
      data.completed = nowCompleted;
      data.lastUpdated = new Date().toISOString();

      const updateResp = await this.requestWithFallback('PUT', 'variables_update', `/variables/${questVar.id}`, {
        value: JSON.stringify(data)
      });
      if (updateResp.status !== 200) return { success: false, error: `Update failed ${updateResp.status}` };
      return { success: true, questData: data, isNewQuest: isNew, wasCompleted: nowCompleted && !wasCompletedBefore };
    } else {
      if (results.length) this.log('[GUARD] Search returned rows but none matched exact key; creating new key:', key);
      data = {
        type: questType, target: defaultTarget(questType),
        progress: Number(inc || 1), completed: false, claimed: false,
        date: today, createdAt: startOfTodayISO(), lastUpdated: new Date().toISOString()
      };
      data.completed = data.progress >= data.target;
      let createResp = await this.requestWithFallback('POST', 'variables_create', '/variables', {
        key, value: JSON.stringify(data), gameServerId: CONFIG.gameServerId, playerId, moduleId: CONFIG.moduleId
      });
      if (![200,201].includes(createResp.status)) {
        createResp = await this.requestWithFallback('POST', 'variable_create', '/variable', {
          key, value: JSON.stringify(data), gameServerId: CONFIG.gameServerId, playerId, moduleId: CONFIG.moduleId
        });
        if (![200,201].includes(createResp.status)) return { success: false, error: `Create failed ${createResp.status}` };
      }
      return { success: true, questData: data, isNewQuest: true, wasCompleted: data.completed };
    }
  }

  async sendPlayerMessage(playerName, message) {
    if (!await this.initAuth()) return false;
    const safeName = String(playerName).replace(/"/g, '\\"');
    const safeMsg = String(message).replace(/"/g, '\\"');
    const resp = await this.requestWithFallback('POST', 'gameserver_command', `/gameserver/${CONFIG.gameServerId}/command`, {
      command: `pm "${safeName}" "${safeMsg}"`
    });
    return resp.status >= 200 && resp.status < 300;
  }

  async handleQuestUpdate(playerName, questType, inc = 1) {
    const playerId = await this.findPlayerByName(playerName);
    if (!playerId) return { success: false, error: 'Player not found' };
    const result = await this.updateQuestProgress(playerId, questType, inc);
    if (result.success) {
      const t = mapQuestType(questType);
      let msg = null;
      if (result.wasCompleted) msg = `Daily ${t} completed!`;
      else if (result.isNewQuest) msg = `Daily ${t} started: ${result.questData.progress}/${result.questData.target}`;
      else msg = `Daily ${t}: ${result.questData.progress}/${result.questData.target}`;
      if (msg) await this.sendPlayerMessage(playerName, msg);
    }
    return result;
  }

  async test() {
    try { if (!await this.initAuth()) return false; await this.findPlayerByName('TestPlayer'); return true; }
    catch { return false; }
  }
}

export default TakaroQuestClientV154;