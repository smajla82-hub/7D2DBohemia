// =====================================
// FILE: playerConnect.js (v0.2.1 - rotation aware + new quests bootstrap)
// Ensures player has current day's ACTIVE quests on login & PMs on refresh.
// Also ensures session for timespent and deathless_start for unkillable.
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
function getPragueDateString() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const GLOBAL_DATE_KEY = 'dailyquests_current_date';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_LAST_REFRESH_PREFIX = 'dailyquests_last_refresh_';

const POOL = [
  { type: 'timespent', target: 3600000 },
  { type: 'zombiekills', target: 200 },
  { type: 'levelgain', target: 5 },
  { type: 'shopquest', target: 1 },
  { type: 'unkillable', target: 10800000 },
  { type: 'feralkills', target: 10 },
  { type: 'vulturekills', target: 10 },
  { type: 'dieonce', target: 1 },
];
const ALWAYS = ['vote'];
const TOTAL_DAILY = 5;

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
  const poolCopy = [...POOL];
  for (let i = poolCopy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [poolCopy[i], poolCopy[j]] = [poolCopy[j], poolCopy[i]];
  }
  const chosen = poolCopy.slice(0, Math.min(need, poolCopy.length)).map(p => p.type);
  return [...ALWAYS, ...chosen];
}

function targetFor(type) {
  const t = POOL.find(p => p.type === type);
  if (t) return t.target;
  return type === 'vote' ? 1 : 1;
}

async function pm(gameServerId, name, text) {
  try {
    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
      command: `pm "${name}" "${text}"`
    });
  } catch { }
}

async function ensureDailyQuestsFor(playerId, date, types, gameServerId, moduleId) {
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

  if (types.includes('timespent')) {
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

  if (types.includes('unkillable')) {
    const dkey = `deathless_start_${playerId}_${date}`;
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [dkey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
      });
      if (!s.data.data.length) {
        await takaro.variable.variableControllerCreate({
          key: dkey,
          value: String(Date.now()),
          gameServerId, playerId, moduleId
        });
      }
    } catch { }
  }

  return { created };
}

async function deleteOldQuests(playerId, currentDate, gameServerId, moduleId) {
  try {
    const prefix = `dailyquest_${playerId}_`;
    const search = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] },
      limit: 500
    });
    for (const variable of search.data.data) {
      if (variable.key.startsWith(prefix) && !variable.key.includes(`_${currentDate}_`)) {
        try { await takaro.variable.variableControllerDelete(variable.id); } catch { }
      }
    }
  } catch { }
}

async function main() {
  const { player, gameServerId, module: mod } = data;
  const playerId = player.id;
  const playerName = player.name;
  const today = getPragueDateString();

  // Read active types or compute fallback
  let activeTypes = deterministicSelection(today, gameServerId);
  try {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
    });
    if (res.data.data.length) {
      const payload = JSON.parse(res.data.data[0].value);
      if (payload?.date === today && Array.isArray(payload.types)) {
        activeTypes = payload.types;
      }
    }
  } catch { }

  // Ensure global date exists
  try {
    const existing = await takaro.variable.variableControllerSearch({
      filters: { key: [GLOBAL_DATE_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
    });
    if (!existing.data.data.length) {
      await takaro.variable.variableControllerCreate({
        key: GLOBAL_DATE_KEY, value: today, gameServerId, moduleId: mod.moduleId
      });
    }
  } catch { }

  // Refresh
  const lastKey = PLAYER_LAST_REFRESH_PREFIX + playerId;
  let lastRefresh = null;
  try {
    const s = await takaro.variable.variableControllerSearch({
      filters: { key: [lastKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
    });
    if (s.data.data.length) lastRefresh = s.data.data[0].value;
  } catch { }

  const needsRefresh = lastRefresh !== today;
  if (needsRefresh) {
    await deleteOldQuests(playerId, today, gameServerId, mod.moduleId);
    const { created } = await ensureDailyQuestsFor(playerId, today, activeTypes, gameServerId, mod.moduleId);
    if (created.length > 0) {
      await pm(gameServerId, playerName, 'Your Daily quests have been refreshed! Type /daily to see your new challenges.');
    }
    try {
      const s = await takaro.variable.variableControllerSearch({
        filters: { key: [lastKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
      });
      if (s.data.data.length) {
        await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: today });
      } else {
        await takaro.variable.variableControllerCreate({
          key: lastKey, value: today, gameServerId, playerId, moduleId: mod.moduleId
        });
      }
    } catch { }
  } else {
    await ensureDailyQuestsFor(playerId, today, activeTypes, gameServerId, mod.moduleId);
  }
}

await main();
