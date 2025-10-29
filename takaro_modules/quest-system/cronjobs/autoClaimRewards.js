// =====================================
// FILE: autoClaimRewards.js (v0.3.8)
// - Claims only for quest types that are in today's active set.
// - Rewards from schema; stylized names in PM.
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';

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

const QUEST_DISPLAY_NAMES = {
  timespent: 'TIME SURVIVOR',
  shopquest: 'TRADE BEERS',
  levelgain: 'EXPERIENCE GRINDER',
  zombiekills: 'ZOMBIE HUNTER',
  vote: 'SERVER SUPPORTER',
  unkillable: 'UNKILLABLE',
  feralkills: 'FERAL WHO?',
  vulturekills: 'COME DOWN!',
  dieonce: 'DEATH? I DONT CARE'
};

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

function rewardFor(type) {
  const defaults = {
    defaultBeers: 25,
    voteBeers: 50,
    unkillableBeers: 50,
    dieonceBeers: 50,
    feralkillsBeers: 25,
    vulturekillsBeers: 25
  };
  const map = {
    vote: 'rewards.voteBeers',
    unkillable: 'rewards.unkillableBeers',
    dieonce: 'rewards.dieonceBeers',
    feralkills: 'rewards.feralkillsBeers',
    vulturekills: 'rewards.vulturekillsBeers'
  };
  const val = cfgGet(map[type] || '', undefined);
  const num = Number(val);
  if (!Number.isNaN(num)) return num;
  const def = Number(cfgGet('rewards.defaultBeers', defaults.defaultBeers));
  return def;
}

async function getActiveTypesToday(gameServerId, moduleId, today) {
  try {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [moduleId] }
    });
    if (res.data.data.length) {
      const p = JSON.parse(res.data.data[0].value);
      if (p?.date === today && Array.isArray(p.types)) return p.types;
    }
  } catch { }
  // Fallback to a sensible minimum if missing
  return ['vote', 'levelgain', 'zombiekills', 'feralkills', 'dieonce'];
}

async function main() {
  const { gameServerId, module: mod } = data;
  const today = pragueDateString();

  const activeTypes = await getActiveTypesToday(gameServerId, mod.moduleId, today);
  const allowed = new Set(activeTypes);

  const res = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [mod.moduleId] },
    limit: 1000
  });

  for (const v of res.data.data) {
    if (!v.key.startsWith('dailyquest_') || !v.key.includes(`_${today}_`)) continue;
    const type = (v.key.split('_')[3] || '').trim();
    if (!allowed.has(type)) continue; // ignore stray types not in today's rotation

    let payload;
    try { payload = JSON.parse(v.value); } catch { continue; }
    if (!payload || !payload.completed || payload.claimed) continue;

    const playerId = v.playerId;
    const beers = rewardFor(type);
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, playerId, { currency: beers });

      payload.claimed = true;
      await takaro.variable.variableControllerUpdate(v.id, { value: JSON.stringify(payload) });

      try {
        const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gameServerId, playerId)).data.data;
        const player = await takaro.player.playerControllerGetOne(pog.playerId);
        const name = player.data.data.name;
        const nice = QUEST_DISPLAY_NAMES[type] || type.toUpperCase();
        await pm(gameServerId, name, `✔ ${nice} reward claimed: ${beers} beers.`);
      } catch { }
    } catch { }
  }
}

await main();
