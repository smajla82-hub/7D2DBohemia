// =====================================
// FILE: autoInitDailyQuests.js (v0.2.1 - rotation + new quests)
// - Europe/Prague date for keys
// - Deterministic daily selection (server/day)
// - Always include 'vote', pick remaining from POOL
// - Retention=0 cleanup for prior-day quests
// - Initialize session for timespent and deathless_start for unkillable
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

// Quest pool (vote is always included)
// Targets:
// - timespent: 1h (ms); vote: 1; zombiekills: 200; levelgain: 5; shopquest:1
// - unkillable: 3h (ms)
// - feralkills: 10; vulturekills: 10; dieonce: 1
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

const GLOBAL_DATE_KEY = 'dailyquests_current_date';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_LAST_REFRESH_PREFIX = 'dailyquests_last_refresh_';

// Deterministic PRNG + hash
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

async function setGlobalDate(date, gameServerId, moduleId) {
  try {
    const existing = await takaro.variable.variableControllerSearch({
      filters: { key: [GLOBAL_DATE_KEY], gameServerId: [gameServerId], moduleId: [moduleId] }
    });
    if (existing.data.data.length) {
      await takaro.variable.variableControllerUpdate(existing.data.data[0].id, { value: date });
    } else {
      await takaro.variable.variableControllerCreate({ key: GLOBAL_DATE_KEY, value: date, gameServerId, moduleId });
    }
  } catch { }
}

async function setDailyActiveTypes(date, types, gameServerId, moduleId) {
  try {
    const existing = await takaro.variable.variableControllerSearch({
      filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [moduleId] }
    });
    const payload = JSON.stringify({ date, types });
    if (existing.data.data.length) {
      await takaro.variable.variableControllerUpdate(existing.data.data[0].id, { value: payload });
    } else {
      await takaro.variable.variableControllerCreate({
        key: DAILY_ACTIVE_TYPES_KEY, value: payload, gameServerId, moduleId
      });
    }
  } catch { }
}

async function deleteOldQuests(playerId, today, gameServerId, moduleId) {
  try {
    const prefix = `dailyquest_${playerId}_`;
    const search = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] },
      limit: 500
    });
    for (const variable of search.data.data) {
      if (variable.key.startsWith(prefix) && !variable.key.includes(`_${today}_`)) {
        try { await takaro.variable.variableControllerDelete(variable.id); } catch { }
      }
    }
  } catch { }
}

function targetFor(type) {
  const t = POOL.find(p => p.type === type);
  if (t) return t.target;
  return type === 'vote' ? 1 : 1;
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
        gameServerId,
        playerId,
        moduleId
      });
      created.push(type);
    } catch { }
  }

  // Session only if timespent is active
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

  // Deathless start only if unkillable is active
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

async function main() {
  const { gameServerId, module: mod } = data;
  const today = getPragueDateString();
  const types = deterministicSelection(today, gameServerId);

  await setGlobalDate(today, gameServerId, mod.moduleId);
  await setDailyActiveTypes(today, types, gameServerId, mod.moduleId);

  // All known players on this server
  let players = [];
  try {
    const res = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId] },
      limit: 1000
    });
    players = res.data.data;
  } catch {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: 'Failed to load player list for daily quest initialization.'
    });
    return;
  }

  let totalCreated = 0;
  for (const p of players) {
    const playerId = p.playerId;
    try {
      await deleteOldQuests(playerId, today, gameServerId, mod.moduleId);
      const { created } = await ensureDailyQuestsFor(playerId, today, types, gameServerId, mod.moduleId);
      totalCreated += created.length;
    } catch { }
  }

  try {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: 'Daily quests have been reset for all players! Type /daily to see your new challenges.'
    });
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `Today’s active quests: ${types.join(', ')}`
    });
  } catch { }

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `[DailyReset] Completed. Players: ${players.length}, Quests created: ${totalCreated}`
  });
}

await main();
