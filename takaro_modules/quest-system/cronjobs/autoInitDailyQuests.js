// =====================================
// FILE: autoInitDailyQuests.js (v0.3.1)
// - Same as v0.3.0 with config polish:
//   * targets read minutes keys (timespentMinutes, unkillableMinutes) -> ms
//   * backward-compatible fallback to old ms keys
//   * typed Set<string> for playerIds fix
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const GLOBAL_DATE_KEY = 'dailyquests_current_date';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_LAST_REFRESH_PREFIX = 'dailyquests_last_refresh_';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';

function nowPrague() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
}
function pragueDateString(d = nowPrague()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const POOL_TYPES = ['timespent', 'zombiekills', 'shopquest', 'unkillable', 'feralkills', 'vulturekills', 'dieonce'];
const ALWAYS = ['vote', 'levelgain'];
const TOTAL_DAILY = 5;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function deterministicSelection(dateStr, gameServerId) {
  const need = Math.max(0, TOTAL_DAILY - ALWAYS.length);
  const seed = hashString(`${dateStr}#${gameServerId}`);
  const rng = mulberry32(seed);
  const copy = [...POOL_TYPES];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  const chosen = copy.slice(0, Math.min(need, copy.length));
  return [...ALWAYS, ...chosen];
}

// Config helpers
function cfgGet(path, fallback) {
  try {
    const get = data?.config?.get?.bind(data.config);
    if (!get) return fallback;
    const v = get(path);
    if (v !== undefined && v !== null && String(v).trim?.() !== '') return v;
    const i = path.indexOf('.');
    if (i > 0) {
      const head = path.slice(0, i);
      const tail = path.slice(i + 1);
      const obj = get(head);
      if (obj && typeof obj === 'object' && obj[tail] !== undefined) return obj[tail];
    }
  } catch { }
  return fallback;
}

function numOrUndef(val) {
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}
// Prefer minutes, fallback to ms, fallback to defaultMs
function minutesOrMs(minKey, msKey, defaultMs) {
  const m = numOrUndef(cfgGet(minKey, undefined));
  if (m !== undefined) return m * 60000;
  const ms = numOrUndef(cfgGet(msKey, undefined));
  if (ms !== undefined) return ms;
  return defaultMs;
}

function targetFor(type) {
  const defaults = {
    timespent: 3600000,
    unkillable: 10800000,
    zombiekills: 200,
    levelgain: 5,
    shopquest: 1,
    feralkills: 10,
    vulturekills: 10,
    dieonce: 1,
    vote: 1
  };
  switch (type) {
    case 'timespent': return minutesOrMs('targets.timespentMinutes', 'targets.timespentMs', defaults.timespent);
    case 'unkillable': return minutesOrMs('targets.unkillableMinutes', 'targets.unkillableMs', defaults.unkillable);
    case 'zombiekills': return numOrUndef(cfgGet('targets.zombiekills', defaults.zombiekills)) ?? defaults.zombiekills;
    case 'levelgain': return numOrUndef(cfgGet('targets.levelgain', defaults.levelgain)) ?? defaults.levelgain;
    case 'shopquest': return numOrUndef(cfgGet('targets.shopquest', defaults.shopquest)) ?? defaults.shopquest;
    case 'feralkills': return numOrUndef(cfgGet('targets.feralkills', defaults.feralkills)) ?? defaults.feralkills;
    case 'vulturekills': return numOrUndef(cfgGet('targets.vulturekills', defaults.vulturekills)) ?? defaults.vulturekills;
    case 'dieonce': return numOrUndef(cfgGet('targets.dieonce', defaults.dieonce)) ?? defaults.dieonce;
    case 'vote': return numOrUndef(cfgGet('targets.vote', defaults.vote)) ?? defaults.vote;
    default: return 1;
  }
}

async function setVar(key, value, gameServerId, moduleId) {
  const s = await takaro.variable.variableControllerSearch({ filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] } });
  if (s.data.data.length) {
    await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value });
  } else {
    await takaro.variable.variableControllerCreate({ key, value, gameServerId, moduleId });
  }
}

async function ensureDailyQuestsFor(playerId, date, types, gameServerId, moduleId, enableTimeTracking) {
  for (const type of types) {
    const key = `dailyquest_${playerId}_${date}_${type}`;
    try {
      const search = await takaro.variable.variableControllerSearch({
        filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (search.data.data.length) continue;

      await takaro.variable.variableControllerCreate({
        key,
        value: JSON.stringify({
          type,
          target: targetFor(type),
          progress: 0,
          completed: false,
          claimed: false,
          date,
          createdAt: new Date().toISOString()
        }),
        gameServerId,
        playerId,
        moduleId
      });
    } catch { }
  }

  if (enableTimeTracking && types.includes('timespent')) {
    const sessionKey = `session_${playerId}_${date}`;
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [sessionKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (!s.data.data.length) {
        await takaro.variable.variableControllerCreate({
          key: sessionKey,
          value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
          gameServerId, playerId, moduleId
        });
      }
    } catch { }
  }
  if (enableTimeTracking && types.includes('unkillable')) {
    const dkey = `deathless_session_${playerId}_${date}`;
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [dkey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (!s.data.data.length) {
        await takaro.variable.variableControllerCreate({
          key: dkey,
          value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
          gameServerId, playerId, moduleId
        });
      }
    } catch { }
  }
}

async function updateUnkillableProgress(playerId, date, gameServerId, moduleId) {
  try {
    const sessionKey = `deathless_session_${playerId}_${date}`;
    const sessionRes = await takaro.variable.variableControllerSearch({
      filters: { key: [sessionKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
    });
    if (!sessionRes.data.data.length) return;

    let session = null;
    const sessVar = sessionRes.data.data[0];
    try {
      session = JSON.parse(sessVar.value);
    } catch { return; }

    const questKey = `dailyquest_${playerId}_${date}_unkillable`;
    const questRes = await takaro.variable.variableControllerSearch({
      filters: { key: [questKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
    });
    if (!questRes.data.data.length) return;
    const qVar = questRes.data.data[0];
    let q = null;
    try {
      q = JSON.parse(qVar.value);
    } catch { return; }

    const now = Date.now();
    const running = session.startTime ? (now - session.startTime) : 0;
    const progress = (session.totalTime || 0) + running;
    q.progress = progress;
    q.completed = (typeof q.target === 'number' && progress >= q.target) ? true : !!q.completed;

    await takaro.variable.variableControllerUpdate(qVar.id, { value: JSON.stringify(q) });
  } catch { }
}

async function main() {
  const { gameServerId, module: mod } = data;
  const today = pragueDateString();
  const enableTimeTracking = !!cfgGet('enableTimeTracking', true);

  // Read reset time from config (support legacy keys too)
  let cfgHHMM = '00:15';
  try {
    const v1 = cfgGet('questResetTime', undefined);
    const v2 = cfgGet('quest_reset_time_hhmm', undefined);
    const v3 = cfgGet('quest_reset_time', undefined);
    cfgHHMM = String((v1 ?? v2 ?? v3) || '00:15').trim();
  } catch { }

  const [cfgH, cfgM] = cfgHHMM.split(':').map((s) => parseInt(s || '0', 10));
  const now = nowPrague();
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  const lastResetS = await takaro.variable.variableControllerSearch({
    filters: { key: [LAST_RESET_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
  });
  const lastReset = lastResetS.data.data.length ? lastResetS.data.data[0].value : null;

  const atResetMoment = nowH === cfgH && nowM === cfgM;
  const shouldRun = atResetMoment && lastReset !== today;

  const activeTypes = deterministicSelection(today, gameServerId);

  await setVar(GLOBAL_DATE_KEY, today, gameServerId, mod.moduleId);
  await setVar(DAILY_ACTIVE_TYPES_KEY, JSON.stringify({ date: today, types: activeTypes }), gameServerId, mod.moduleId);

  if (!shouldRun) return;

  await setVar(LAST_RESET_KEY, today, gameServerId, mod.moduleId);

  const found = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [mod.moduleId] },
    limit: 1000
  });

  const playerIds = new Set<string>();
  for (const v of found.data.data) {
    if (v.key.startsWith('dailyquest_')) {
      const parts = v.key.split('_');
      if (parts.length >= 4) playerIds.add(parts[1]);
    }
  }

  for (const playerId of playerIds) {
    try {
      const res = await takaro.variable.variableControllerSearch({
        filters: { gameServerId: [gameServerId], playerId: [String(playerId)], moduleId: [mod.moduleId] },
        limit: 500
      });
      for (const v of res.data.data) {
        if (v.key.startsWith(`dailyquest_${String(playerId)}_`) && !v.key.includes(`_${today}_`)) {
          try { await takaro.variable.variableControllerDelete(v.id); } catch { }
        }
        if (v.key === `session_${String(playerId)}_${today}` || v.key === `deathless_session_${String(playerId)}_${today}`) {
          try { await takaro.variable.variableControllerDelete(v.id); } catch { }
        }
      }
    } catch { }

    await ensureDailyQuestsFor(String(playerId), today, activeTypes, gameServerId, mod.moduleId, enableTimeTracking);
    if (activeTypes.includes('unkillable') && enableTimeTracking) {
      await updateUnkillableProgress(String(playerId), today, gameServerId, mod.moduleId);
    }
    await setVar(PLAYER_LAST_REFRESH_PREFIX + String(playerId), today, gameServerId, mod.moduleId);
  }

  try {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: 'Daily quests have been refreshed. Good luck!' });
  } catch { }
}

await main();
