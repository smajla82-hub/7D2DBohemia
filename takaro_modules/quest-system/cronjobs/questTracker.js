// v23 - v0.3.35 (REWRITE: Simplified kill tracking - copy working zombieKillReward pattern)
// Changes from v0.3.34:
// - REMOVED complex classifyKill() function - it was buggy
// - NOW uses SIMPLE entity name string matching (like zombieKillReward does)
// - Direct substring checks: includes('feral'), includes('dog'), includes('vulture'), etc.
// - Process ALL kills the same way zombieKillReward does - just count them
// - Increased event limit back to 1000 to match zombieKillReward

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const LAST_RUN_KEY = 'questTracker_last_run';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const PLAYER_RESET_KEY_PREFIX = 'dailyquests_player_reset_at_';
const ALL_DONE_KEY_PREFIX = 'dailyquests_all_done_';
const AUT_CLAIM_PREFIX = 'autoclaim_pending_';
const SHOP_CURRENCY_PROCESSED_PREFIX = 'shopquest_currency_processed_';

const BUDGET_MS = 6000;
const OWN_DAILY_LIMIT = 1000;

function nowPrague() { return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE })); }
function ymd(d = nowPrague()) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${dd}`; }
function addDaysISO(d, days) { return new Date(d.getTime() + days * 86400 * 1000).toISOString(); }

async function pm(gsId, name, text) { try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `pm "${name}" "${text}"` }); } catch { } }
async function say(gsId, text) { try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `say "${text}"` }); } catch { } }

const DISPLAY = {
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
    const cfg = data && data.config && typeof data.config.get === 'function' ? data.config : null;
    if (!cfg) return fallback;
    const v = cfg.get(path);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    const i = path.indexOf('.');
    if (i > 0) { const head = path.slice(0, i), tail = path.slice(i + 1); const obj = cfg.get(head); if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, tail)) return obj[tail]; }
  } catch { }
  return fallback;
}
function num(v, def) { const n = Number(v); return Number.isNaN(n) ? def : n; }
function minutesOrMs(minKey, msKey, defMs) {
  const min = num(cfgGet(minKey, undefined), undefined); if (min !== undefined) return Math.max(0, min) * 60000;
  const ms = num(cfgGet(msKey, undefined), undefined); return ms !== undefined ? Math.max(0, ms) : defMs;
}
function targetMs(type) {
  if (type === 'timespent') return minutesOrMs('targets.timespentMinutes', 'targets.timespentMs', 3600000);
  if (type === 'unkillable') return minutesOrMs('targets.unkillableMinutes', 'targets.unkillableMs', 10800000);
  return 0;
}
function targetCount(type) {
  const d = { vote: 1, zombiekills: 200, levelgain: 5, shopquest: 1, feralkills: 10, vulturekills: 10, dieonce: 1 };
  return num(cfgGet(`targets.${type}`, d[type]), d[type]);
}
function retentionDays() { return num(cfgGet('retentionDays', 7), 7); }

async function getQuestVar(gsId, moduleId, playerId, date, type) {
  const key = `dailyquest_${playerId}_${date}_${type}`;
  const s = await takaro.variable.variableControllerSearch({
    filters: { key: [key], gameServerId: [gsId], playerId: [String(playerId)], moduleId: [moduleId] }, limit: 1
  });
  return s.data.data.length ? s.data.data[0] : null;
}

async function ensureQuestVar(gsId, moduleId, playerId, date, type) {
  const found = await getQuestVar(gsId, moduleId, playerId, date, type);
  if (found) return found;
  try {
    const key = `dailyquest_${playerId}_${date}_${type}`;
    const startOfDay = new Date(nowPrague());
    startOfDay.setHours(0, 0, 0, 0);
    const createdAtISO = startOfDay.toISOString();

    const payload = (type === 'timespent' || type === 'unkillable')
      ? { type, target: targetMs(type), progress: 0, completed: false, claimed: false, date, createdAt: createdAtISO }
      : { type, target: targetCount(type), progress: 0, completed: false, claimed: false, date, createdAt: createdAtISO };
    const created = await takaro.variable.variableControllerCreate({
      key, value: JSON.stringify(payload), gameServerId: gsId, playerId: String(playerId), moduleId
    });
    return created.data.data;
  } catch { return null; }
}

async function saveQuestVar(id, payload) { try { await takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(payload) }); } catch { } }

async function upsertRaw(gsId, moduleId, playerId, key, value, expiresAtISO) {
  try {
    const s = await takaro.variable.variableControllerSearch({ filters: { key: [key], gameServerId: [gsId], playerId: playerId ? [String(playerId)] : undefined, moduleId: [moduleId] }, limit: 1 });
    if (s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: String(value), expiresAt: expiresAtISO });
    else await takaro.variable.variableControllerCreate({ key, value: String(value), gameServerId: gsId, playerId: playerId ? String(playerId) : undefined, moduleId, expiresAt: expiresAtISO });
  } catch { }
}
async function upsertJsonAppendArray(gsId, moduleId, playerId, key, item, expiresAtISO) {
  try {
    const s = await takaro.variable.variableControllerSearch({ filters: { key: [key], gameServerId: [gsId], playerId: [String(playerId)], moduleId: [moduleId] }, limit: 1 });
    if (s.data.data.length) {
      let arr; try { arr = JSON.parse(s.data.data[0].value); } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
      arr.push(item);
      await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(arr), expiresAt: expiresAtISO });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify([item]), gameServerId: gsId, playerId: String(playerId), moduleId, expiresAt: expiresAtISO });
    }
  } catch { }
}
async function upsertJsonAddToSet(gsId, moduleId, playerId, key, item, expiresAtISO) {
  try {
    const s = await takaro.variable.variableControllerSearch({ filters: { key: [key], gameServerId: [gsId], playerId: [String(playerId)], moduleId: [moduleId] }, limit: 1 });
    if (s.data.data.length) {
      let arr; try { arr = JSON.parse(s.data.data[0].value); } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
      if (arr.includes(item)) return false;
      arr.push(item);
      await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(arr), expiresAt: expiresAtISO });
      return true;
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify([item]), gameServerId: gsId, playerId: String(playerId), moduleId, expiresAt: expiresAtISO });
      return true;
    }
  } catch { }
  return false;
}

async function getPlayerName(gsId, pogId) {
  try {
    const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gsId, pogId)).data.data;
    const p = await takaro.player.playerControllerGetOne(pog.playerId);
    return p.data.data.name;
  } catch { return null; }
}
async function notifyComplete(gsId, pid, type) { try { const name = await getPlayerName(gsId, pid); if (!name) return; await pm(gsId, name, `✔ ${(DISPLAY[type] || type.toUpperCase())} complete! Reward will be claimed shortly.`); } catch { } }

// v0.3.35 FIX: SIMPLIFIED kill classification - just check entity string directly
function classifyKill(e) {
  const entity = String(e?.meta?.entity || '').toLowerCase();

  // Simple checks - just like zombieKillReward does
  const isZombie = entity.length > 0 && entity !== 'player' && entity !== 'animal';
  const isFeral = entity.includes('feral');
  const isVulture = entity.includes('zombie vulture') || (entity.includes('vulture') && entity !== 'vulture');
  const isZombieDog = entity.includes('zombie dog') || (entity.includes('dog') && entity.includes('zombie'));

  return { isZombie, isFeral, isVulture: isVulture || isZombieDog };
}

function isCompletedShop(e) {
  const s = String((e && e.meta && e.meta.status) || (e && e.payload && e.payload.status) || '').toUpperCase();
  return s === 'COMPLETED' || s === 'SUCCESS' || s === 'DONE';
}

async function fetchEvents(gsId, eventName, sinceISO, limit = 1000) {
  try {
    const r = await takaro.event.eventControllerSearch({ filters: { eventName: [eventName], gameserverId: [gsId] }, greaterThan: { createdAt: sinceISO }, limit });
    return r.data.data || [];
  } catch { return []; }
}

async function main() {
  const t0 = Date.now(); const within = () => Date.now() - t0 < BUDGET_MS;
  const gsId = data.gameServerId, mod = data.module;
  const date = ymd();

  let lastRun = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const r = await takaro.variable.variableControllerSearch({ filters: { key: [LAST_RUN_KEY], gameServerId: [gsId], moduleId: [mod.moduleId] }, limit: 1 });
    if (r.data.data.length) { const v = r.data.data[0].value; if (v) lastRun = new Date(v); }
  } catch { }
  const sinceISO = lastRun.toISOString();

  const expISO = addDaysISO(nowPrague(), retentionDays());

  // EVENTS FIRST - v0.3.35: increased to 1000 like zombieKillReward
  if (within()) {
    const kills = await fetchEvents(gsId, 'entity-killed', sinceISO, 1000);
    for (const e of kills) {
      if (!within()) break;
      const pid = String(e.playerId || ''); if (!pid) continue;
      const { isZombie, isFeral, isVulture } = classifyKill(e);

      if (isZombie) {
        const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'zombiekills');
        if (v) {
          let q; try { q = JSON.parse(v.value); } catch { q = null; } if (q && !q.completed) {
            q.progress = (q.progress || 0) + 1; const tgt = targetCount('zombiekills'); q.target ||= tgt;
            if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'zombiekills'); }
            await saveQuestVar(v.id, q);
          }
        }
      }
      if (isFeral) {
        const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'feralkills');
        if (v) {
          let q; try { q = JSON.parse(v.value); } catch { q = null; } if (q && !q.completed) {
            q.progress = (q.progress || 0) + 1; const tgt = targetCount('feralkills'); q.target ||= tgt;
            if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'feralkills'); }
            await saveQuestVar(v.id, q);
          }
        }
      }
      if (isVulture) {
        const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'vulturekills');
        if (v) {
          let q; try { q = JSON.parse(v.value); } catch { q = null; } if (q && !q.completed) {
            q.progress = (q.progress || 0) + 1; const tgt = targetCount('vulturekills'); q.target ||= tgt;
            if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'vulturekills'); }
            await saveQuestVar(v.id, q);
          }
        }
      }
    }
  }

  if (within()) {
    const shops = await fetchEvents(gsId, 'shop-order-status-changed', sinceISO, 300);
    for (const e of shops) {
      if (!within()) break;
      const pid = String(e.playerId || ''); if (!pid) continue;
      if (!isCompletedShop(e)) continue;
      const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'shopquest') || (await ensureQuestVar(gsId, mod.moduleId, pid, date, 'shopquest'));
      if (!v) continue; let q; try { q = JSON.parse(v.value); } catch { q = null; } if (!q || q.completed) continue;
      q.progress = (q.progress || 0) + 1; const tgt = targetCount('shopquest'); q.target ||= tgt;
      if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'shopquest'); }
      await saveQuestVar(v.id, q);
    }
  }

  if (within()) {
    const curr = await fetchEvents(gsId, 'currency-deducted', sinceISO, 1000);
    for (const e of curr) {
      if (!within()) break;
      const pid = String(e.playerId || ''); if (!pid) continue;
      const evtId = String(e.id || ''); if (!evtId) continue;
      const setKey = `${SHOP_CURRENCY_PROCESSED_PREFIX}${pid}_${date}`;
      const added = await upsertJsonAddToSet(gsId, mod.moduleId, pid, setKey, evtId, expISO);
      if (!added) continue;

      const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'shopquest') || (await ensureQuestVar(gsId, mod.moduleId, pid, date, 'shopquest'));
      if (!v) continue; let q; try { q = JSON.parse(v.value); } catch { q = null; } if (!q || q.completed) continue;
      q.progress = (q.progress || 0) + 1; const tgt = targetCount('shopquest'); q.target ||= tgt;
      if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'shopquest'); }
      await saveQuestVar(v.id, q);
    }
  }

  if (within()) {
    const deaths = await fetchEvents(gsId, 'player-death', sinceISO, 300);
    for (const e of deaths) {
      if (!within()) break;
      const pid = String(e.playerId || ''); if (!pid) continue;
      const v = await getQuestVar(gsId, mod.moduleId, pid, date, 'dieonce') || (await ensureQuestVar(gsId, mod.moduleId, pid, date, 'dieonce'));
      if (!v) continue; let q; try { q = JSON.parse(v.value); } catch { q = null; } if (!q || q.completed) continue;
      q.progress = 1; q.completed = true; q.target ||= 1;
      await saveQuestVar(v.id, q);
    }
  }

  // TIME TRACKING - secondary priority
  if (within()) {
    const players = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({ filters: { gameServerId: [gsId], online: [true] }, limit: 500 });
    for (const p of (players?.data?.data || [])) {
      if (!within()) break;
      const pid = String(p.playerId || '');
      const now = Date.now();

      // TIMESPENT
      const sessionKey = `session_${pid}_${date}`;
      const s = await takaro.variable.variableControllerSearch({ filters: { key: [sessionKey], gameServerId: [gsId], moduleId: [mod.moduleId] }, limit: 1 });
      if (s.data.data.length) {
        let sess; try { sess = JSON.parse(s.data.data[0].value); } catch { sess = null; }
        if (sess && sess.startTime) {
          sess.totalTime = (sess.totalTime || 0) + Math.max(0, now - (sess.lastUpdate || sess.startTime));
          sess.lastUpdate = now;
          await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(sess) });

          const qVar = await getQuestVar(gsId, mod.moduleId, pid, date, 'timespent');
          if (qVar) {
            let q; try { q = JSON.parse(qVar.value); } catch { q = null; } if (q && !q.completed) {
              q.progress = sess.totalTime; const tgt = targetMs('timespent'); q.target ||= tgt;
              if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'timespent'); }
              await saveQuestVar(qVar.id, q);
            }
          }
        }
      }

      // UNKILLABLE
      const uKey = `dailyquest_${pid}_${date}_unkillable`;
      const uq = await takaro.variable.variableControllerSearch({ filters: { key: [uKey], gameServerId: [gsId], playerId: [pid], moduleId: [mod.moduleId] }, limit: 1 });
      if (uq.data.data.length) {
        let qu; try { qu = JSON.parse(uq.data.data[0].value); } catch { qu = null; }
        if (qu && !qu.completed) {
          const startKey = `deathless_start_${pid}_${date}`;
          const sr = await takaro.variable.variableControllerSearch({ filters: { key: [startKey], gameServerId: [gsId], playerId: [pid], moduleId: [mod.moduleId] }, limit: 1 });
          if (sr.data.data.length) {
            const startTs = Number(sr.data.data[0].value) || now;
            const prog = Math.max(0, now - startTs);
            qu.progress = prog; const tgt = targetMs('unkillable'); qu.target ||= tgt;
            if (qu.progress >= tgt) { qu.completed = true; await notifyComplete(gsId, pid, 'unkillable'); }
            await saveQuestVar(uq.data.data[0].id, qu);
          }
        }
      }
    }
  }

  // ALL-5-DONE AWARD
  if (within()) {
    const r = await takaro.variable.variableControllerSearch({ filters: { gameServerId: [gsId], moduleId: [mod.moduleId] }, limit: 500 });
    const players = new Set();
    const activeTodayTypes = new Set();

    for (const v of r.data.data) {
      if (!v.key.startsWith('dailyquest_')) continue;
      if (!v.key.includes(`_${date}_`)) continue;
      players.add(String(v.playerId || ''));
      const parts = v.key.split('_');
      if (parts.length >= 4) activeTodayTypes.add(parts[3]);
    }

    for (const pidRaw of players) {
      if (!within()) break;
      const pid = String(pidRaw);
      const doneKey = `${ALL_DONE_KEY_PREFIX}${pid}_${date}`;

      let doneSearch = await takaro.variable.variableControllerSearch({ filters: { key: [doneKey], gameServerId: [gsId], moduleId: [mod.moduleId] }, limit: 1 });
      if (doneSearch.data.data.length) continue;

      let allComplete = true;
      for (const t of activeTodayTypes) {
        const qVar = await getQuestVar(gsId, mod.moduleId, pid, date, t);
        if (!qVar) { allComplete = false; break; }
        let q; try { q = JSON.parse(qVar.value); } catch { q = null; }
        if (!q || !q.completed) { allComplete = false; break; }
      }
      if (!allComplete) continue;

      await upsertRaw(gsId, mod.moduleId, pid, doneKey, String(Date.now()), expISO);
      const autoKey = `${AUT_CLAIM_PREFIX}${pid}_${date}`;
      await upsertJsonAppendArray(gsId, mod.moduleId, pid, autoKey, { type: 'allcomplete', reward: { item: 'beer', amount: 200 }, source: 'all-dailies', date, createdAt: new Date().toISOString() }, expISO);

      const name = (await getPlayerName(gsId, pid)) || 'Player';
      await say(gsId, `✪Congrats to ${name} for finishing all quests today! Beer reward is on its way!✪`);
      await pm(gsId, name, `✔All Daily quests done, 200 beers awarded✔`);
    }
  }

  // STAMP LAST RUN
  try {
    const nowISO = new Date().toISOString();
    const s = await takaro.variable.variableControllerSearch({ filters: { key: [LAST_RUN_KEY], gameServerId: [gsId], moduleId: [mod.moduleId] }, limit: 1 });
    if (s.data.data.length) await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: nowISO });
    else await takaro.variable.variableControllerCreate({ key: LAST_RUN_KEY, value: nowISO, gameServerId: gsId, moduleId: mod.moduleId });
  } catch { }
}

await main();
