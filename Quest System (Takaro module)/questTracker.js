// =====================================
// FILE: questTracker.js (v0.2.1 - resilient event fetch + diagnostics + TS-safe pending parser)
// Tracks: zombiekills, shopquest, timespent, unkillable, feralkills, vulturekills, dieonce
// - Europe/Prague date keys
// - Enqueues completions for auto-claim (5s delayed cron)
// - Dual event filter key fallback (gameserverId vs gameServerId)
// - Writes last error to questdiag_last_error for quick inspection
// - ✔ headline at both ends; no trailing !
// =====================================
import { takaro, data } from '@takaro/helpers';

const CHECK_ICON = '✔';
const TIME_ZONE = 'Europe/Prague';
const PENDING_PREFIX = 'autoclaim_pending_';
const DIAG_KEY = 'questdiag_last_error';

function getPragueDateString() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function recordDiag(gameServerId, moduleId, msg, extra = {}) {
  try {
    const payload = { at: new Date().toISOString(), msg: String(msg), ...extra };
    const search = await takaro.variable.variableControllerSearch({
      filters: { key: [DIAG_KEY], gameServerId: [gameServerId], moduleId: [moduleId] }
    });
    if (search.data.data.length) {
      await takaro.variable.variableControllerUpdate(search.data.data[0].id, { value: JSON.stringify(payload) });
    } else {
      await takaro.variable.variableControllerCreate({
        key: DIAG_KEY, value: JSON.stringify(payload), gameServerId, moduleId
      });
    }
  } catch { }
}

async function getPlayerName(playerId, fallback = null) {
  try {
    const playerRes = await takaro.player.playerControllerGetOne(playerId);
    if (playerRes?.data?.data?.name) return playerRes.data.data.name;
  } catch (e) { }
  return fallback || `Player_${playerId}`;
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

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * @typedef {{ type: string, completedAt: number }} PendingItem
 * @typedef {{ items: PendingItem[] }} PendingPayload
 */

/**
 * Safely parse pending payload into normalized shape.
 * @param {string} str
 * @returns {PendingPayload}
 */
function parsePendingPayload(str) {
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      const items = parsed.items
        .filter((i) => i && typeof i.type === 'string')
        .map((i) => ({
          type: String(i.type),
          completedAt: typeof i.completedAt === 'number' ? i.completedAt : Date.now(),
        }));
      return { items };
    }
  } catch { }
  return { items: [] };
}

async function fetchEventsSince(eventName, sinceIso, gameServerId) {
  // Try both filter names; merge/dedupe results
  const out = [];
  const seen = new Set();
  async function one(filters) {
    try {
      const res = await takaro.event.eventControllerSearch({
        filters,
        greaterThan: { createdAt: sinceIso },
        limit: 1000
      });
      for (const ev of (res?.data?.data || [])) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        out.push(ev);
      }
    } catch (e) {
      // swallow; caller logs diag
    }
  }
  await one({ eventName: [eventName], gameserverId: [gameServerId] });
  await one({ eventName: [eventName], gameServerId: [gameServerId] }); // alt key
  return out;
}

async function main() {
  const { gameServerId, module: mod } = data;
  const VARIABLE_KEY = 'lastQuestUpdate';
  const today = getPragueDateString();

  async function sendCompletionPM(playerId, questType) {
    const playerName = await getPlayerName(playerId);
    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
      command: `pm "${playerName}" "${CHECK_ICON} Daily ${QUEST_DISPLAY_NAMES[questType] || questType} quest completed ${CHECK_ICON} Your well deserved reward will arrive shortly on your account!"`
    });
  }

  try {
    // Last run time (fallback 5 mins back)
    const lastRunRes = await takaro.variable.variableControllerSearch({
      filters: { key: [VARIABLE_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
    });
    const lastRun = lastRunRes.data.data.length
      ? new Date(lastRunRes.data.data[0].value)
      : new Date(Date.now() - 5 * 60 * 1000);

    // 1) entity-killed (zombies, feral, vultures)
    try {
      const killEvents = await fetchEventsSince('entity-killed', lastRun.toISOString(), gameServerId);
      for (const event of killEvents) {
        if (!event.playerId) continue;
        const meta = (event && event.meta) || {};
        const entity = String(meta.entity ?? '');
        const entLower = entity.toLowerCase();

        await incrementQuest(event.playerId, 'zombiekills', 1, sendCompletionPM, today);
        if (entLower.includes('feral')) {
          await incrementQuest(event.playerId, 'feralkills', 1, sendCompletionPM, today);
        }
        if (entLower.includes('vulture')) {
          await incrementQuest(event.playerId, 'vulturekills', 1, sendCompletionPM, today);
        }
      }
    } catch (e) {
      await recordDiag(gameServerId, mod.moduleId, 'entity-killed section crashed', { err: String(e) });
    }

    // 2) Shop orders
    try {
      const shopEvents = await fetchEventsSince('shop-order-status-changed', lastRun.toISOString(), gameServerId);
      for (const event of shopEvents) {
        if (!event.playerId) continue;
        await incrementQuest(event.playerId, 'shopquest', 1, sendCompletionPM, today);
      }
    } catch (e) {
      await recordDiag(gameServerId, mod.moduleId, 'shop-order section crashed', { err: String(e) });
    }

    // 3) Player deaths -> dieonce + reset deathless
    try {
      const deathEvents = await fetchEventsSince('player-death', lastRun.toISOString(), gameServerId);
      for (const event of deathEvents) {
        if (!event.playerId) continue;
        await incrementQuest(event.playerId, 'dieonce', 1, sendCompletionPM, today);
        const dkey = `deathless_start_${event.playerId}_${today}`;
        try {
          const s = await takaro.variable.variableControllerSearch({
            filters: { key: [dkey], gameServerId: [gameServerId], playerId: [event.playerId], moduleId: [mod.moduleId] }
          });
          const now = Date.now();
          if (s.data.data.length) {
            await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: String(now) });
          } else {
            await takaro.variable.variableControllerCreate({
              key: dkey,
              value: String(now),
              gameServerId,
              playerId: event.playerId,
              moduleId: mod.moduleId
            });
          }
        } catch (e2) {
          await recordDiag(gameServerId, mod.moduleId, 'deathless reset failed', { err: String(e2) });
        }
      }
    } catch (e) {
      await recordDiag(gameServerId, mod.moduleId, 'player-death section crashed', { err: String(e) });
    }

    // 4) Timespent + UNKILLABLE progress for ONLINE players
    try {
      const onlinePlayers = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [gameServerId], online: [true] }
      });

      for (const playerOnServer of (onlinePlayers?.data?.data || [])) {
        const playerId = playerOnServer.playerId;
        const currentTime = Date.now();

        // Timespent session
        const sessionKey = `session_${playerId}_${today}`;
        const timeQuestKey = `dailyquest_${playerId}_${today}_timespent`;

        // Load or init session
        let sessionVar = await takaro.variable.variableControllerSearch({
          filters: { key: [sessionKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });

        let sessionData;
        if (sessionVar.data.data.length > 0) {
          sessionData = safeJSON(sessionVar.data.data[0].value, { startTime: currentTime, totalTime: 0, lastUpdate: currentTime });
          const timeSinceLastUpdate = Math.min(currentTime - (sessionData.lastUpdate || currentTime), 5 * 60 * 1000);
          sessionData.totalTime = (sessionData.totalTime || 0) + Math.max(timeSinceLastUpdate, 0);
          sessionData.lastUpdate = currentTime;

          await takaro.variable.variableControllerUpdate(sessionVar.data.data[0].id, {
            value: JSON.stringify(sessionData)
          });
        } else {
          sessionData = { startTime: currentTime, totalTime: 0, lastUpdate: currentTime };
          await takaro.variable.variableControllerCreate({
            key: sessionKey,
            value: JSON.stringify(sessionData),
            gameServerId,
            playerId,
            moduleId: mod.moduleId
          });
        }

        // Push session time into timespent quest
        const timeQuestVar = await takaro.variable.variableControllerSearch({
          filters: { key: [timeQuestKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });

        if (timeQuestVar.data.data.length > 0) {
          const questRecord = timeQuestVar.data.data[0];
          const questData = safeJSON(questRecord.value, null);
          if (questData && !questData.completed) {
            questData.progress = sessionData.totalTime;
            const completedNow = questData.progress >= questData.target;
            if (completedNow) {
              questData.progress = questData.target;
              questData.completed = true;
              try { await sendCompletionPM(playerId, 'timespent'); } catch { }
              await enqueueAutoClaim(playerId, 'timespent', today, gameServerId, mod.moduleId);
            }
            await takaro.variable.variableControllerUpdate(questRecord.id, {
              value: JSON.stringify(questData)
            });
          }
        }

        // UNKILLABLE: compute progress since last death
        const unkillableKey = `dailyquest_${playerId}_${today}_unkillable`;
        try {
          const uq = await takaro.variable.variableControllerSearch({
            filters: { key: [unkillableKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
          });
          if (uq.data.data.length) {
            const urec = uq.data.data[0];
            const udata = safeJSON(urec.value, null);
            if (udata && !udata.completed) {
              // read or init deathless start
              const startKey = `deathless_start_${playerId}_${today}`;
              let startTs = Date.now();
              try {
                const dr = await takaro.variable.variableControllerSearch({
                  filters: { key: [startKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
                });
                if (dr.data.data.length) startTs = Number(dr.data.data[0].value) || Date.now();
                else {
                  await takaro.variable.variableControllerCreate({
                    key: startKey,
                    value: String(startTs),
                    gameServerId,
                    playerId,
                    moduleId: mod.moduleId
                  });
                }
              } catch (e2) {
                await recordDiag(gameServerId, mod.moduleId, 'unkillable start read/create failed', { err: String(e2) });
              }

              const progress = Math.max(0, currentTime - startTs);
              udata.progress = Math.min(udata.target, progress);
              const done = udata.progress >= udata.target;
              if (done) {
                udata.completed = true;
                try { await sendCompletionPM(playerId, 'unkillable'); } catch { }
                await enqueueAutoClaim(playerId, 'unkillable', today, gameServerId, mod.moduleId);
              }
              await takaro.variable.variableControllerUpdate(urec.id, { value: JSON.stringify(udata) });
            }
          }
        } catch (e) {
          await recordDiag(gameServerId, mod.moduleId, 'unkillable progress failed', { err: String(e) });
        }
      }
    } catch (e) {
      await recordDiag(gameServerId, mod.moduleId, 'online progress section crashed', { err: String(e) });
    }

    // Save new last run
    if (lastRunRes.data.data.length) {
      await takaro.variable.variableControllerUpdate(lastRunRes.data.data[0].id, {
        value: new Date().toISOString()
      });
    } else {
      await takaro.variable.variableControllerCreate({
        key: VARIABLE_KEY,
        value: new Date().toISOString(),
        gameServerId,
        moduleId: mod.moduleId
      });
    }
  } catch (err) {
    await recordDiag(gameServerId, mod.moduleId, 'top-level crash', { err: String(err) });
  }

  async function incrementQuest(playerId, questType, amount, onComplete, dateStr) {
    const { gameServerId, module: mod } = data;
    const questKey = `dailyquest_${playerId}_${dateStr}_${questType}`;
    try {
      const questVar = await takaro.variable.variableControllerSearch({
        filters: { key: [questKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
      });
      if (!questVar.data.data.length) return;
      const record = questVar.data.data[0];
      const questData = safeJSON(record.value, null);
      if (!questData) return;
      if (questData.completed) return;

      questData.progress = Math.min((questData.progress || 0) + amount, questData.target);
      const completedNow = questData.progress >= questData.target;
      if (completedNow) {
        questData.completed = true;
        try { await onComplete(playerId, questType); } catch { }
        await enqueueAutoClaim(playerId, questType, dateStr, gameServerId, mod.moduleId);
      }
      await takaro.variable.variableControllerUpdate(record.id, { value: JSON.stringify(questData) });
    } catch (e) {
      await recordDiag(gameServerId, mod.moduleId, 'incrementQuest failed', { type: questType, err: String(e) });
    }
  }
}

async function enqueueAutoClaim(playerId, questType, dateStr, gameServerId, moduleId) {
  const key = `${PENDING_PREFIX}${playerId}_${dateStr}`;
  try {
    const existing = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
    });
    const now = Date.now();
    if (existing.data.data.length) {
      const rec = existing.data.data[0];
      /** @type {PendingPayload} */
      const payload = parsePendingPayload(rec.value);

      if (!payload.items.find((i) => i.type === questType)) {
        payload.items.push({ type: questType, completedAt: now });
        await takaro.variable.variableControllerUpdate(rec.id, { value: JSON.stringify(payload) });
      }
    } else {
      /** @type {PendingPayload} */
      const payload = { items: [{ type: questType, completedAt: now }] };
      await takaro.variable.variableControllerCreate({
        key,
        value: JSON.stringify(payload),
        gameServerId,
        playerId,
        moduleId
      });
    }
  } catch (e) {
    await recordDiag(gameServerId, moduleId, 'enqueueAutoClaim failed', { err: String(e) });
  }
}

await main();
