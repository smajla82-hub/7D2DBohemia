// =====================================
// FILE: autoInitDailyQuests.js (v0.3.11)
// - Single-player force reset (`dailyquests_force_player`)
// - Force reset overrides date/time gates
// - Fallback delete: if per-player search returns 0, delete by key prefix
// - Idempotent reset: if quest key exists, reset it (progress=0, claimed=false, completed=false) instead of skipping
// - Normalizes createdAt to start-of-day
// - Debug -> dailyquests_last_reset_debug, Error -> dailyquests_last_reset_error
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';
const PLAYER_LAST_REFRESH_PREFIX = 'dailyquests_last_refresh_';
const FORCE_RESET_KEY = 'dailyquests_force_reset';
const FORCE_PLAYER_KEY = 'dailyquests_force_player';
const DEBUG_KEY = 'dailyquests_last_reset_debug';
const ERROR_KEY = 'dailyquests_last_reset_error';

function nowPrague() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
}
function pragueDateString(d = nowPrague()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function startOfTodayISO() {
  const d = nowPrague();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
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

function cfgGet(path, fallback) {
  try {
    const get = data?.config?.get?.bind(data.config);
    if (!get) return fallback;
    const v = get(path);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
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
function minutesOrMs(minKey, msKey, defaultMs) {
  const m = numOrUndef(cfgGet(minKey, undefined));
  if (m !== undefined) return Math.max(0, m) * 60000;
  const ms = numOrUndef(cfgGet(msKey, undefined));
  if (ms !== undefined) return Math.max(0, ms);
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
    default: return numOrUndef(cfgGet(`targets.${type}`, defaults[type])) ?? defaults[type];
  }
}

async function upsertVar(key, value, gameServerId, moduleId) {
  const s = await takaro.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] }, limit: 1
  });
  if (s.data.data.length) {
    await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value });
  } else {
    await takaro.variable.variableControllerCreate({ key, value, gameServerId, moduleId });
  }
}
async function appendDebug(lines, gameServerId, moduleId) {
  try {
    const s = await takaro.variable.variableControllerSearch({
      filters: { key: [DEBUG_KEY], gameServerId: [gameServerId], moduleId: [moduleId] }, limit: 1
    });
    let arr = [];
    if (s.data.data.length) {
      try { arr = JSON.parse(s.data.data[0].value); } catch { }
      if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
      arr.push(...lines);
      await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(arr.slice(-150)) });
    } else {
      await takaro.variable.variableControllerCreate({
        key: DEBUG_KEY, value: JSON.stringify(lines), gameServerId, moduleId
      });
    }
  } catch { }
}
async function setError(msg, gameServerId, moduleId) {
  try { await upsertVar(ERROR_KEY, String(msg), gameServerId, moduleId); } catch { }
}

// Fallback: find player's quest vars by key prefix
async function fetchPlayerQuestVarsByPrefix(gameServerId, moduleId, playerId, today) {
  try {
    const res = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] }, limit: 5000
    });
    const prefix = `dailyquest_${playerId}_`;
    const out = [];
    for (const v of (res?.data?.data || [])) {
      if (typeof v.key === 'string' && v.key.startsWith(prefix)) out.push(v);
    }
    return out;
  } catch { return []; }
}

async function main() {
  const { gameServerId, module: mod } = data;
  const today = pragueDateString();
  const todayStartISO = startOfTodayISO();
  const debug = [`start:${new Date().toISOString()}`, `today:${today}`];

  // Reset time
  let cfgHHMM = '00:15';
  try {
    const v1 = cfgGet('questResetTime', undefined);
    const v2 = cfgGet('quest_reset_time_hhmm', undefined);
    const v3 = cfgGet('quest_reset_time', undefined);
    cfgHHMM = String((v1 ?? v2 ?? v3) || '00:15').trim();
  } catch { }
  debug.push(`cfgHHMM:${cfgHHMM}`);
  const [cfgH, cfgM] = cfgHHMM.split(':').map(s => parseInt(s || '0', 10));
  const now = nowPrague();
  debug.push(`nowH:${now.getHours()}`, `nowM:${now.getMinutes()}`);

  // Last reset
  let lastReset = null;
  try {
    const lr = await takaro.variable.variableControllerSearch({
      filters: { key: [LAST_RESET_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }, limit: 1
    });
    if (lr.data.data.length) lastReset = lr.data.data[0].value;
  } catch { }
  debug.push(`lastReset:${lastReset}`);

  // Force flags
  let forceReset = false, forceVarId = null, forcePlayer = null, forcePlayerVarId = null;
  try {
    const fr = await takaro.variable.variableControllerSearch({
      filters: { key: [FORCE_RESET_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }, limit: 1
    });
    if (fr.data.data.length) { forceVarId = fr.data.data[0].id; forceReset = !!fr.data.data[0].value; }
  } catch { }
  try {
    const fp = await takaro.variable.variableControllerSearch({
      filters: { key: [FORCE_PLAYER_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }, limit: 1
    });
    if (fp.data.data.length) { forcePlayerVarId = fp.data.data[0].id; forcePlayer = String(fp.data.data[0].value || '').trim() || null; }
  } catch { }
  debug.push(`forceReset:${forceReset}`, `forcePlayer:${forcePlayer || ''}`);

  const dateChanged = lastReset !== today;
  const isPastResetTime = (now.getHours() > cfgH) || (now.getHours() === cfgH && now.getMinutes() >= cfgM);
  debug.push(`dateChanged:${dateChanged}`, `isPastResetTime:${isPastResetTime}`);

  const shouldRun = forceReset || (dateChanged && isPastResetTime);
  debug.push(`shouldRun:${shouldRun}`, `mode:${forcePlayer ? 'single' : 'all'}`);

  const activeTypes = deterministicSelection(today, gameServerId);
  try { await upsertVar(DAILY_ACTIVE_TYPES_KEY, JSON.stringify({ date: today, types: activeTypes }), gameServerId, mod.moduleId); } catch { }
  await appendDebug(debug, gameServerId, mod.moduleId);

  if (!shouldRun) return;

  // Mark reset
  try { await upsertVar(LAST_RESET_KEY, today, gameServerId, mod.moduleId); } catch { }

  // Target players
  let playerIds = [];
  if (forcePlayer) {
    playerIds = [forcePlayer];
  } else {
    try {
      const playersRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [gameServerId] }, limit: 500
      });
      for (const p of (playersRes?.data?.data || [])) if (p.playerId) playerIds.push(String(p.playerId));
    } catch { }
  }

  // Delete (or flag for reset) all quest vars for target players
  let deletedCount = 0, toResetKeys = new Set();
  for (const pid of playerIds) {
    // 1) Try precise per-player fetch
    let pv = [];
    try {
      const r = await takaro.variable.variableControllerSearch({
        filters: { gameServerId: [gameServerId], moduleId: [mod.moduleId], playerId: [pid] }, limit: 2000
      });
      pv = r?.data?.data || [];
    } catch { }
    // 2) Fallback by key prefix if none found
    if (!pv.length) {
      pv = await fetchPlayerQuestVarsByPrefix(gameServerId, mod.moduleId, pid, today);
    }

    for (const v of pv) {
      if (!v.key || !v.key.startsWith('dailyquest_')) continue;
      const isCurrent = v.key.includes(`_${today}_`);
      let claimed = false;
      if (isCurrent) {
        try { const parsed = JSON.parse(v.value); claimed = !!parsed.claimed; } catch { }
      }
      if (!isCurrent || claimed) {
        try { await takaro.variable.variableControllerDelete(v.id); deletedCount++; } catch { }
      } else {
        // Current but not claimed: reset in place if key matches activeTypes (idempotent)
        const parts = v.key.split('_'); // dailyquest_<pid>_<date>_<type>
        const type = parts[3] || '';
        if (activeTypes.includes(type)) {
          try {
            const payload = {
              type, target: targetFor(type), progress: 0, completed: false, claimed: false, date: today, createdAt: startOfTodayISO()
            };
            await takaro.variable.variableControllerUpdate(v.id, { value: JSON.stringify(payload) });
            toResetKeys.add(v.key);
          } catch { }
        }
      }
    }
  }
  await appendDebug([`deleted:${deletedCount}`, `resetInPlace:${toResetKeys.size}`], gameServerId, mod.moduleId);

  // Create fresh quests for target players (if not present after deletion/reset)
  let createdCount = 0, updatedCount = 0;
  for (const pid of playerIds) {
    for (const type of activeTypes) {
      const key = `dailyquest_${pid}_${today}_${type}`;
      try {
        const search = await takaro.variable.variableControllerSearch({
          filters: { key: [key], gameServerId: [gameServerId], playerId: [pid], moduleId: [mod.moduleId] }, limit: 1
        });
        if (search.data.data.length) {
          // Ensure it's fresh; reset if needed (idempotent safety)
          try {
            let q = null;
            try { q = JSON.parse(search.data.data[0].value); } catch { }
            const needsReset = !q || q.date !== today || q.claimed || q.completed || (q.progress && q.progress !== 0);
            if (needsReset) {
              const payload = { type, target: targetFor(type), progress: 0, completed: false, claimed: false, date: today, createdAt: startOfTodayISO() };
              await takaro.variable.variableControllerUpdate(search.data.data[0].id, { value: JSON.stringify(payload) });
              updatedCount++;
            }
          } catch { }
          continue;
        }
        await takaro.variable.variableControllerCreate({
          key,
          value: JSON.stringify({ type, target: targetFor(type), progress: 0, completed: false, claimed: false, date: today, createdAt: startOfTodayISO() }),
          gameServerId, playerId: pid, moduleId: mod.moduleId
        });
        createdCount++;
      } catch { }
    }

    // Session vars
    if (activeTypes.includes('timespent')) {
      const sessKey = `session_${pid}_${today}`;
      try {
        const s = await takaro.variable.variableControllerSearch({
          filters: { key: [sessKey], gameServerId: [gameServerId], playerId: [pid], moduleId: [mod.moduleId] }, limit: 1
        });
        if (!s.data.data.length) {
          await takaro.variable.variableControllerCreate({
            key: sessKey,
            value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
            gameServerId, playerId: pid, moduleId: mod.moduleId
          });
        }
      } catch { }
    }
    if (activeTypes.includes('unkillable')) {
      const dKey = `deathless_session_${pid}_${today}`;
      try {
        const d = await takaro.variable.variableControllerSearch({
          filters: { key: [dKey], gameServerId: [gameServerId], playerId: [pid], moduleId: [mod.moduleId] }, limit: 1
        });
        if (!d.data.data.length) {
          await takaro.variable.variableControllerCreate({
            key: dKey,
            value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
            gameServerId, playerId: pid, moduleId: mod.moduleId
          });
        }
      } catch { }
    }
    try { await upsertVar(PLAYER_LAST_REFRESH_PREFIX + pid, today, gameServerId, mod.moduleId); } catch { }
  }
  await appendDebug([`created:${createdCount}`, `updated:${updatedCount}`], gameServerId, mod.moduleId);

  // Remove force flags if present
  try { if (forceVarId) await takaro.variable.variableControllerDelete(forceVarId); } catch { }
  try { if (forcePlayerVarId) await takaro.variable.variableControllerDelete(forcePlayerVarId); } catch { }

  try {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `✅ Daily quests RESET complete (${playerIds.length === 1 ? 'targeted' : 'all'}).` });
  } catch { }
  await appendDebug([`done:${new Date().toISOString()}`], gameServerId, mod.moduleId);
}

try { await main(); } catch (e) {
  try { await setError(e && e.message ? e.message : String(e), data.gameServerId, data.module.moduleId); } catch { }
}
