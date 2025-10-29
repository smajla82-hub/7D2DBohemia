// =====================================
// FILE: playerConnect.js (v0.3.0)
// - Ensures player has today's ACTIVE quests
// - Creates sessions for time-based quests when enabled
// - PM when refreshed
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
function pragueDateString() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
async function pm(gameServerId, name, text) {
  try {
    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, { command: `pm "${name}" "${text}"` });
  } catch { }
}

const GLOBAL_DATE_KEY = 'dailyquests_current_date';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_LAST_REFRESH_PREFIX = 'dailyquests_last_refresh_';

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
function targetFor(type) {
  const map = {
    timespent: 'targets.timespentMs',
    unkillable: 'targets.unkillableMs',
    zombiekills: 'targets.zombiekills',
    levelgain: 'targets.levelgain',
    shopquest: 'targets.shopquest',
    feralkills: 'targets.feralkills',
    vulturekills: 'targets.vulturekills',
    dieonce: 'targets.dieonce',
    vote: 'targets.vote'
  };
  const defaults = {
    timespent: 3600000, unkillable: 10800000, zombiekills: 200, levelgain: 5,
    shopquest: 1, feralkills: 10, vulturekills: 10, dieonce: 1, vote: 1
  };
  const key = map[type] || '';
  const raw = key ? cfgGet(key, undefined) : undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? (defaults[type] ?? 1) : n;
}

async function ensureDailyQuestsFor(playerId, date, types, gameServerId, moduleId, enableTimeTracking) {
  const created = [];
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
        gameServerId, playerId, moduleId
      });
      created.push(type);
    } catch { }
  }

  if (enableTimeTracking && types.includes('timespent')) {
    const sk = `session_${playerId}_${date}`;
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [sk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (!s.data.data.length) {
        await takaro.variable.variableControllerCreate({
          key: sk, value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
          gameServerId, playerId, moduleId
        });
      }
    } catch { }
  }
  if (enableTimeTracking && types.includes('unkillable')) {
    const dk = `deathless_session_${playerId}_${date}`;
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [dk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (!s.data.data.length) {
        await takaro.variable.variableControllerCreate({
          key: dk, value: JSON.stringify({ startTime: Date.now(), totalTime: 0, lastUpdate: Date.now() }),
          gameServerId, playerId, moduleId
        });
      }
    } catch { }
  }
  return { created };
}

async function main() {
  const { player, gameServerId, module: mod } = data;
  if (!player) return;
  const playerId = player.id;
  const name = player.name;
  const today = pragueDateString();
  const enableTimeTracking = !!cfgGet('enableTimeTracking', true);

  // Read today's active types
  let activeTypes = null;
  try {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
    });
    if (res.data.data.length) {
      const p = JSON.parse(res.data.data[0].value);
      if (p?.date === today && Array.isArray(p.types)) activeTypes = p.types;
    }
  } catch { }
  if (!activeTypes) {
    // fallback if global wasn't set yet
    activeTypes = ['vote', 'levelgain', 'timespent', 'zombiekills', 'unkillable'];
  }

  // Check if player needs refresh today
  let lastRef = null;
  try {
    const s = await takaro.variable.variableControllerSearch({
      filters: { key: [PLAYER_LAST_REFRESH_PREFIX + playerId], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
    });
    if (s.data.data.length) lastRef = s.data.data[0].value;
  } catch { }
  const needs = lastRef !== today;

  if (needs) {
    // delete prior-day quests
    try {
      const all = await takaro.variable.variableControllerSearch({
        filters: { gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }, limit: 500
      });
      for (const v of all.data.data) {
        if (v.key.startsWith(`dailyquest_${playerId}_`) && !v.key.includes(`_${today}_`)) {
          try { await takaro.variable.variableControllerDelete(v.id); } catch { }
        }
      }
    } catch { }
    const { created } = await ensureDailyQuestsFor(playerId, today, activeTypes, gameServerId, mod.moduleId, enableTimeTracking);
    if (created.length) await pm(gameServerId, name, 'Your Daily quests have been refreshed! Type /daily to see the challenges.');
    // stamp refresh
    try {
      await takaro.variable.variableControllerCreate({
        key: PLAYER_LAST_REFRESH_PREFIX + playerId, value: today, gameServerId, playerId, moduleId: mod.moduleId
      });
    } catch {
      try {
        const s = await takaro.variable.variableControllerSearch({
          filters: { key: [PLAYER_LAST_REFRESH_PREFIX + playerId], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: today });
      } catch { }
    }
  } else {
    await ensureDailyQuestsFor(playerId, today, activeTypes, gameServerId, mod.moduleId, enableTimeTracking);
  }
}

await main();
