/**
 * Takaro Quest Integration Client - v15.6-patch4
 *
 * Patch4 goals (on top of patch3):
 * 1) Self-heal on 401: requestWithFallback() now detects expired/invalid
 *    sessions, forces re-authentication via initAuth(), and retries the
 *    request once. Previously `authenticated` was cached to `true` forever,
 *    so once the Takaro session token expired every request kept failing
 *    with 401 forever (root cause of the 2026-08-10 incident: game-monitor
 *    error log grew to ~2GB and the quest retry queue never drained).
 *
 * Patch3 goals (kept):
 * 1) Keep your working hardcoded CONFIG fallbacks (email/password/gameServerId/moduleId).
 * 2) Fix "Create failed 404" + retry storms by NEVER calling singular endpoints:
 *    - /variable
 *    - /variable/search
 *    - /variable/:id
 *    Use plural only:
 *    - /variables
 *    - /variables/search
 *    - /variables/:id
 *
 * 3) Keep PATH_PREFIXES locked to [''] only (no /api/v1 learning).
 * 4) Add bad-path cache: if a path returns 404 once, we won't keep retrying it.
 * 5) Keep ALL debug helpers used by working_server.js:
 *    - getQuestVarByName
 *    - scanTodayPlayerQuests
 *    - repairQuest
 *    - setQuest
 *
 * NOTE: This file fixes the Takaro-side 404 spam and 401-after-expiry hang.
 * The "level jump 10->35" issue is in integrated_game_monitor.py (listplayers
 * diff logic + stale local level cache) and needs a separate patch there.
 */

import http from 'http';
import https from 'https';

const VERSION = 'v15.6-patch4';

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
    vote: 1,
    levelgain: 5,
    zombiekills: 200,
    feralkills: 10,
    vulturekills: 10,
    timespent: 3600000,
    unkillable: 10800000,
    shopquest: 1,
    dieonce: 1,
    tradebeers: 1
  };
  return map[type] ?? 1;
}
function mapQuestType(t) {
  const m = {
    levelup: 'levelgain',
    levelgain: 'levelgain',
    vote: 'vote',
    zombiekills: 'zombiekills',
    feralkills: 'feralkills',
    vulturekills: 'vulturekills',
    timespent: 'timespent',
    unkillable: 'unkillable',
    shopquest: 'shopquest',
    dieonce: 'dieonce',
    tradebeers: 'tradebeers'
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

/**
 * Takaro API on https://api.takaro.io:
 * - Do NOT use /api, /v1, /api/v1 prefixes for these endpoints (you confirmed 404).
 * - Keep ONLY '' so we never learn a wrong prefix.
 */
const PATH_PREFIXES = [''];
const pathCache = new Map();     // cacheKey -> resolved full path (suffix)
const badPathCache = new Set();  // full path (suffix) that returned 404

function normalizeIdentityHint(identityHintOrSteamId) {
  if (!identityHintOrSteamId) return null;

  if (typeof identityHintOrSteamId === 'string' || typeof identityHintOrSteamId === 'number') {
    const v = String(identityHintOrSteamId).trim();
    if (v) return { kind: 'steam', value: v };
    return null;
  }

  if (typeof identityHintOrSteamId === 'object') {
    const kind = String(identityHintOrSteamId.kind || '').toLowerCase().trim();
    const value = String(identityHintOrSteamId.value || '').trim();
    if (!kind || !value) return null;
    if (!['steam', 'xbl', 'eos'].includes(kind)) return null;
    return { kind, value };
  }

  return null;
}

function normalizeXblId(x) {
  if (!x) return null;
  let v = String(x).trim();
  v = v.replace(/^XBL_/, '').trim();
  return v || null;
}

function normalizeEosId(x) {
  if (!x) return null;
  let v = String(x).trim();
  v = v.replace(/^EOS_/, '').trim();
  return v || null;
}

class TakaroQuestClientV156 {
  constructor() {
    this.version = VERSION;
    this.cookieJar = '';
    this.authenticated = false;
    this.playerCache = new Map();
    this.authStrategyChosen = null;
  }

  log(...a) { console.log(`[TAKARO ${VERSION}]`, ...a); }

  async initAuth(force = false) {
    if (this.authenticated && !force) return true;

    // Clear caches when auth state is (re)built (prevents stale/bad cached paths)
    pathCache.clear();
    badPathCache.clear();
    this.authenticated = false;
    this.cookieJar = '';
    this.authStrategyChosen = null;

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
        username: CONFIG.email,
        password: CONFIG.password
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

  async authenticate() {
    this.log('Legacy authenticate() called; delegating to initAuth()');
    return this.initAuth();
  }

  async ensureAuthenticated() { return this.initAuth(); }

  // Force a brand-new login, ignoring any cached "authenticated" state.
  // Used when a request comes back with 401 (expired/invalid session).
  async reauthenticate() {
    this.log('Session expired or invalid (401) - forcing re-authentication.');
    return this.initAuth(true);
  }

  requestRaw(method, path, data = null, extraHeaders = {}) {
    return new Promise((resolve) => {
      const url = new URL(path.startsWith('http') ? path : CONFIG.baseUrl + path);
      const body = data ? JSON.stringify(data) : null;
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;

      const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...extraHeaders };
      if (this.cookieJar) headers.Cookie = this.cookieJar;

      if (this.authStrategyChosen === 'basic') {
        const b64 = Buffer.from(`${CONFIG.basicUser}:${CONFIG.basicPass}`).toString('base64');
        headers.Authorization = `Basic ${b64}`;
      } else if (this.authStrategyChosen === 'bearer') {
        headers.Authorization = `Bearer ${CONFIG.bearerToken}`;
      } else if (['adminMint', 'login'].includes(this.authStrategyChosen)) {
        const tokenMatch = /takaro-token=([^;]+)/.exec(this.cookieJar);
        if (tokenMatch) headers.Authorization = `Bearer ${tokenMatch[1]}`;
      }

      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const options = {
        method,
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        port: url.port || (isHttps ? 443 : 80),
        headers,
        agent: new mod.Agent({ keepAlive: true })
      };

      const req = mod.request(options, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }

          if (res.statusCode === 404) {
            const p = url.pathname + (url.search || '');
            console.error('[TAKARO PATH 404]', method, url.toString());
            // Remember exact suffix so we don't retry it again (prevents storms)
            badPathCache.add(p);
          }

          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      });

      req.on('error', err => resolve({ status: 599, data: { error: err.message }, headers: {} }));
      if (body) req.write(body);
      req.end();
    });
  }

  async requestWithFallback(method, cacheKey, suffix, data = null) {
    // Path already known to work - use it, but self-heal on 401
    if (pathCache.has(cacheKey)) {
      const full = pathCache.get(cacheKey);
      let resp = await this.requestRaw(method, full, data);
      if (resp.status === 401) {
        const reAuthOk = await this.reauthenticate();
        if (reAuthOk) {
          resp = await this.requestRaw(method, full, data);
        }
      }
      return resp;
    }

    for (const prefix of PATH_PREFIXES) {
      const full = `${prefix}${suffix}`; // prefix is '' by design

      // Skip known-bad 404 paths (avoid retry storms)
      if (badPathCache.has(full)) continue;

      let resp = await this.requestRaw(method, full, data);

      // Session expired/invalid: force re-auth and retry this same path once.
      if (resp.status === 401) {
        const reAuthOk = await this.reauthenticate();
        if (reAuthOk) {
          resp = await this.requestRaw(method, full, data);
        }
      }

      if (resp.status >= 200 && resp.status < 300) {
        pathCache.set(cacheKey, full);
        return resp;
      }

      // if 404, requestRaw() already added it to badPathCache
    }

    // No success, last attempt (still plural-only logic should prevent 404 loops)
    let resp = await this.requestRaw(method, suffix, data);
    if (resp.status === 401) {
      const reAuthOk = await this.reauthenticate();
      if (reAuthOk) {
        resp = await this.requestRaw(method, suffix, data);
      }
    }
    return resp;
  }

  // PATCH: use ONLY plural /variables/:id
  async putVariableById(id, valueJsonString, cacheKeyPrefix = 'var_put') {
    const body = { value: valueJsonString };
    return this.requestWithFallback('PUT', `${cacheKeyPrefix}_variables_${id}`, `/variables/${id}`, body);
  }

  // ---------- Player resolution helpers ----------

  async findPlayerByName(name) {
    if (this.playerCache.has(`name:${name}`)) return this.playerCache.get(`name:${name}`);
    if (!await this.initAuth()) return null;

    let r = await this.requestWithFallback('POST', 'player_search_exact', '/player/search', {
      filters: { name: [name] }, limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const found = { id: a[0].id, name: a[0].name };
        this.playerCache.set(`name:${name}`, found);
        return found;
      }
    }

    r = await this.requestWithFallback('POST', 'player_search_partial', '/player/search', {
      search: { name: [name] }, limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const found = { id: a[0].id, name: a[0].name };
        this.playerCache.set(`name:${name}`, found);
        return found;
      }
    }

    r = await this.requestWithFallback('POST', 'gameserver_player_search', '/gameserver/player/search', {
      filters: { gameServerId: [CONFIG.gameServerId] },
      search: { name: [name] },
      extend: ['player'],
      limit: 1
    });
    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const pid = a[0]?.playerId || a[0]?.player?.id || null;
        const pname = a[0]?.player?.name || null;
        if (pid) {
          const found = { id: pid, name: pname || name };
          this.playerCache.set(`name:${name}`, found);
          return found;
        }
      }
    }

    return null;
  }

  async findPlayerBySteamId(steamId) {
    if (!steamId) return null;
    const sid = String(steamId).trim();
    const key = `steam:${sid}`;
    if (this.playerCache.has(key)) return this.playerCache.get(key);
    if (!await this.initAuth()) return null;

    let r = await this.requestWithFallback('POST', 'player_search_steam_exact', '/player/search', {
      filters: { steamId: [sid] },
      limit: 1
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const found = { id: a[0].id, name: a[0].name };
        this.playerCache.set(key, found);
        return found;
      }
    }

    r = await this.requestWithFallback('POST', 'gameserver_player_search_steam', '/gameserver/player/search', {
      filters: { gameServerId: [CONFIG.gameServerId] },
      extend: ['player'],
      limit: 500
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      for (const row of a) {
        const pid = row?.playerId || row?.player?.id || null;
        const st = row?.player?.steamId || row?.steamId || null;
        const pname = row?.player?.name || null;
        if (pid && st && String(st) === sid) {
          const found = { id: pid, name: pname || null };
          this.playerCache.set(key, found);
          return found;
        }
      }
    }

    return null;
  }

  async findPlayerByXboxLiveId(xblId) {
    const xid = normalizeXblId(xblId);
    if (!xid) return null;

    const key = `xbl:${xid}`;
    if (this.playerCache.has(key)) return this.playerCache.get(key);
    if (!await this.initAuth()) return null;

    let r = await this.requestWithFallback('POST', 'player_search_xbl_exact', '/player/search', {
      filters: { xboxLiveId: [xid] },
      limit: 1
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const found = { id: a[0].id, name: a[0].name };
        this.playerCache.set(key, found);
        return found;
      }
    }

    r = await this.requestWithFallback('POST', 'gameserver_player_search_xbl', '/gameserver/player/search', {
      filters: { gameServerId: [CONFIG.gameServerId] },
      extend: ['player'],
      limit: 500
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      for (const row of a) {
        const pid = row?.playerId || row?.player?.id || null;
        const x = row?.player?.xboxLiveId || row?.xboxLiveId || null;
        const pname = row?.player?.name || null;
        if (pid && x && String(x) === xid) {
          const found = { id: pid, name: pname || null };
          this.playerCache.set(key, found);
          return found;
        }
      }
    }

    return null;
  }

  async findPlayerByEosId(eosId) {
    const eid = normalizeEosId(eosId);
    if (!eid) return null;

    const key = `eos:${eid}`;
    if (this.playerCache.has(key)) return this.playerCache.get(key);
    if (!await this.initAuth()) return null;

    let r = await this.requestWithFallback('POST', 'player_search_eos_exact', '/player/search', {
      filters: { epicOnlineServicesId: [eid] },
      limit: 1
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      if (a.length) {
        const found = { id: a[0].id, name: a[0].name };
        this.playerCache.set(key, found);
        return found;
      }
    }

    r = await this.requestWithFallback('POST', 'gameserver_player_search_eos', '/gameserver/player/search', {
      filters: { gameServerId: [CONFIG.gameServerId] },
      extend: ['player'],
      limit: 500
    });

    if (r.status === 200) {
      const a = unpackArray(r);
      for (const row of a) {
        const pid = row?.playerId || row?.player?.id || null;
        const e = row?.player?.epicOnlineServicesId || row?.epicOnlineServicesId || null;
        const pname = row?.player?.name || null;
        if (pid && e && String(e) === eid) {
          const found = { id: pid, name: pname || null };
          this.playerCache.set(key, found);
          return found;
        }
      }
    }

    return null;
  }

  async resolvePlayer(identityHint, playerName) {
    const hint = normalizeIdentityHint(identityHint);

    if (hint?.kind === 'steam') {
      const p = await this.findPlayerBySteamId(hint.value);
      if (p?.id) return { playerId: p.id, playerName: p.name || playerName };
    }

    if (hint?.kind === 'xbl') {
      const p = await this.findPlayerByXboxLiveId(hint.value);
      if (p?.id) return { playerId: p.id, playerName: p.name || playerName };
    }

    if (hint?.kind === 'eos') {
      const p = await this.findPlayerByEosId(hint.value);
      if (p?.id) return { playerId: p.id, playerName: p.name || playerName };
    }

    const p = await this.findPlayerByName(playerName);
    if (p?.id) return { playerId: p.id, playerName: p.name || playerName };

    return null;
  }

  async getPlayerIdByName(name) {
    const p = await this.findPlayerByName(name);
    return p?.id || null;
  }

  // ---------- Quest operations (plural-only) ----------

  async getQuestVarByName(playerName, rawType) {
    const playerId = await this.getPlayerIdByName(playerName);
    if (!playerId) return { ok: false, error: 'Player not found' };

    const type = mapQuestType(rawType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${type}`;

    const payload = {
      filters: {
        key: [key],
        gameServerId: [CONFIG.gameServerId],
        playerId: [playerId],
        moduleId: [CONFIG.moduleId]
      },
      limit: 3
    };

    const resp = await this.requestWithFallback('POST', 'variables_search_debug', '/variables/search', payload);
    const arr = unpackArray(resp);
    const row = arr.find(v => v.key === key) || null;

    let parsed = null;
    if (row) {
      try { parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; }
      catch { parsed = row.value; }
    }

    return { ok: true, playerId, key, row, value: parsed };
  }

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
      try { val = typeof v.value === 'string' ? JSON.parse(v.value) : v.value; }
      catch { val = v.value; }

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
      filters: {
        key: [key],
        gameServerId: [CONFIG.gameServerId],
        playerId: [playerId],
        moduleId: [CONFIG.moduleId]
      },
      limit: 5
    };

    const resp = await this.requestWithFallback('POST', 'variables_search_repair', '/variables/search', payload);
    const arr = unpackArray(resp);
    const row = arr.find(v => v.key === key);
    if (!row) return { ok: false, error: 'Key not found for repair', key };

    let val;
    try { val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; }
    catch { val = {}; }

    val.type = type;
    val.target = target != null ? target : defaultTarget(type);
    if (progress != null) val.progress = progress;
    else if (val.progress == null) val.progress = 0;
    val.completed = completed != null ? completed : (val.progress >= val.target);
    val.claimed = claimed != null ? claimed : (val.claimed || false);
    val.date = today;
    val.lastUpdated = new Date().toISOString();
    if (!val.createdAt) val.createdAt = startOfTodayISO();

    const up = await this.putVariableById(row.id, JSON.stringify(val), 'repair_put');
    if (up.status !== 200) return { ok: false, error: `PUT failed ${up.status}` };

    return { ok: true, key, value: val };
  }

  async setQuest(playerId, questType, { progress, target, completed, claimed } = {}) {
    if (!await this.initAuth()) return { ok: false, error: 'Auth failed' };

    const type = mapQuestType(questType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${type}`;

    const payload = {
      filters: {
        key: [key],
        gameServerId: [CONFIG.gameServerId],
        playerId: [playerId],
        moduleId: [CONFIG.moduleId]
      },
      limit: 3
    };

    const searchResp = await this.requestWithFallback('POST', 'variables_search_set', '/variables/search', payload);
    const arr = unpackArray(searchResp);
    const row = arr.find(v => v.key === key);

    const val = {
      type,
      target: target != null ? target : defaultTarget(type),
      progress: progress != null ? progress : 0,
      completed: completed != null
        ? completed
        : (progress != null ? progress >= (target != null ? target : defaultTarget(type)) : false),
      claimed: claimed != null ? claimed : false,
      date: today,
      createdAt: startOfTodayISO(),
      lastUpdated: new Date().toISOString()
    };

    if (row) {
      const up = await this.putVariableById(row.id, JSON.stringify(val), 'set_put');
      if (up.status !== 200) return { ok: false, error: `PUT failed ${up.status}` };
      return { ok: true, action: 'updated', key, value: val };
    }

    const createResp = await this.requestWithFallback('POST', 'variables_create_set', '/variables', {
      key,
      value: JSON.stringify(val),
      gameServerId: CONFIG.gameServerId,
      playerId,
      moduleId: CONFIG.moduleId
    });

    if (![200, 201].includes(createResp.status)) {
      return { ok: false, error: `Create failed ${createResp.status}` };
    }

    return { ok: true, action: 'created', key, value: val };
  }

  async updateQuestProgress(playerId, rawType, inc = 1) {
    if (!await this.initAuth()) return { success: false, error: 'Not authenticated' };

    const questType = mapQuestType(rawType);
    const today = pragueToday();
    const key = `dailyquest_${playerId}_${today}_${questType}`;

    const searchPayload = {
      filters: {
        key: [key],
        gameServerId: [CONFIG.gameServerId],
        playerId: [playerId],
        moduleId: [CONFIG.moduleId]
      },
      limit: 5
    };

    // plural only
    const searchResp = await this.requestWithFallback('POST', 'variables_search', '/variables/search', searchPayload);
    const results = unpackArray(searchResp) || [];

    const questVar = results.find(v =>
      v?.key === key &&
      v?.playerId === playerId &&
      v?.gameServerId === CONFIG.gameServerId &&
      v?.moduleId === CONFIG.moduleId
    );

    let data;
    let isNew = false;

    if (questVar) {
      try { data = typeof questVar.value === 'string' ? JSON.parse(questVar.value) : questVar.value; }
      catch { data = null; }

      if (!data) {
        data = {
          type: questType,
          target: defaultTarget(questType),
          progress: 0,
          completed: false,
          claimed: false,
          date: today,
          createdAt: startOfTodayISO()
        };
        isNew = true;
      }

      if (data.date !== today) {
        data.progress = 0;
        data.completed = false;
        data.claimed = false;
        data.date = today;
        data.createdAt = startOfTodayISO();
      }

      data.type = questType;
      data.target = data.target ?? defaultTarget(questType);
      data.progress = Math.min((data.progress ?? 0) + Number(inc || 1), data.target);

      const nowCompleted = data.progress >= data.target;
      const wasCompletedBefore = !!data.completed;
      data.completed = nowCompleted;
      data.lastUpdated = new Date().toISOString();

      const up = await this.putVariableById(questVar.id, JSON.stringify(data), 'update_progress_put');
      if (up.status !== 200) return { success: false, error: `Update failed ${up.status}` };

      return { success: true, questData: data, isNewQuest: isNew, wasCompleted: nowCompleted && !wasCompletedBefore };
    }

    // Create if not found (plural only)
    data = {
      type: questType,
      target: defaultTarget(questType),
      progress: Number(inc || 1),
      completed: false,
      claimed: false,
      date: today,
      createdAt: startOfTodayISO(),
      lastUpdated: new Date().toISOString()
    };
    data.completed = data.progress >= data.target;

    const createResp = await this.requestWithFallback('POST', 'variables_create', '/variables', {
      key,
      value: JSON.stringify(data),
      gameServerId: CONFIG.gameServerId,
      playerId,
      moduleId: CONFIG.moduleId
    });

    if (![200, 201].includes(createResp.status)) {
      return { success: false, error: `Create failed ${createResp.status}` };
    }

    return { success: true, questData: data, isNewQuest: true, wasCompleted: data.completed };
  }

  async sendPlayerMessage(playerName, message) {
    if (!await this.initAuth()) return false;

    const safeName = String(playerName).replace(/"/g, '\\"');
    const safeMsg = String(message).replace(/"/g, '\\"');

    const resp = await this.requestWithFallback(
      'POST',
      'gameserver_command',
      `/gameserver/${CONFIG.gameServerId}/command`,
      { command: `pm "${safeName}" "${safeMsg}"` }
    );

    return resp.status >= 200 && resp.status < 300;
  }

  async handleQuestUpdate(playerName, questType, inc = 1, identityHintOrLegacySteamId = null) {
    const resolved = await this.resolvePlayer(identityHintOrLegacySteamId, playerName);
    if (!resolved?.playerId) return { success: false, error: 'Player not found' };

    const result = await this.updateQuestProgress(resolved.playerId, questType, inc);

    if (result.success) {
      const t = mapQuestType(questType);
      let msg = null;

      if (result.wasCompleted) msg = `Daily ${t} completed!`;
      else if (result.isNewQuest) msg = `Daily ${t} started: ${result.questData.progress}/${result.questData.target}`;
      else msg = `Daily ${t}: ${result.questData.progress}/${result.questData.target}`;

      if (msg) {
        // Use canonical Takaro player name when possible (prevents alias weirdness)
        await this.sendPlayerMessage(resolved.playerName || playerName, msg);
      }
    }

    return result;
  }

  async test() {
    try {
      if (!await this.initAuth()) return false;
      await this.findPlayerByName('TestPlayer');
      return true;
    } catch {
      return false;
    }
  }
}

export default TakaroQuestClientV156;
