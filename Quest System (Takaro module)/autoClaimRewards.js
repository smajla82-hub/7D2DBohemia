// =====================================
// FILE: autoClaimRewards.js (Cron ~every 15s, TS-safe payload parsing)
// Processes pending quest completions older than 5s and auto-claims rewards.
// Sends a single batched PM per player.
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const PENDING_PREFIX = 'autoclaim_pending_';
const AUTOCLAIM_DELAY_MS = 5000; // 5 seconds

/** @type {Record<string, number>} Reward mapping (in "beers") */
const REWARD_MAP = {
  vote: 50,
  unkillable: 50,
  dieonce: 50,
  feralkills: 25,
  vulturekills: 25,
  default: 25
};

// Award header wrapper (BMP-safe)
const AWARD_WRAP = '✪';

function getPragueDateString() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * @typedef {{ type: string, completedAt: number }} PendingItem
 * @typedef {{ items: PendingItem[] }} PendingPayload
 */

/**
 * Safely parse pending payload JSON.
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

function pluralize(n, singular, plural) {
  return n === 1 ? singular : plural;
}

async function getPlayerName(playerId) {
  try {
    const res = await takaro.player.playerControllerGetOne(playerId);
    if (res?.data?.data?.name) return res.data.data.name;
  } catch { }
  return `Player_${playerId}`;
}

/**
 * Return reward amount for a quest type with a safe string key.
 * @param {string} t
 * @returns {number}
 */
function rewardFor(t) {
  return REWARD_MAP[t] ?? REWARD_MAP.default;
}

async function main() {
  const { gameServerId, module: mod } = data;
  const today = getPragueDateString();
  const now = Date.now();

  // Fetch variables for this module/server and scan for pending keys (limit 1000)
  let vars;
  try {
    const res = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [mod.moduleId] },
      limit: 1000
    });
    vars = res.data.data;
  } catch {
    return; // can't proceed
  }

  const pendingVars = vars.filter((v) => v.key.startsWith(PENDING_PREFIX) && v.key.endsWith(`_${today}`));

  for (const pv of pendingVars) {
    const playerId = pv.playerId;
    /** @type {PendingPayload} */
    const payload = parsePendingPayload(pv.value);
    const items = payload.items;

    const ready = items.filter((i) => (now - (i.completedAt || 0)) >= AUTOCLAIM_DELAY_MS);
    if (!ready.length) continue;

    /** @type {string[]} */
    const readyTypes = Array.from(new Set(ready.map((i) => String(i.type))));

    let claimedCount = 0;
    let totalBeers = 0;

    for (const t of readyTypes) {
      const type = String(t);
      const questKey = `dailyquest_${playerId}_${today}_${type}`;
      try {
        const qres = await takaro.variable.variableControllerSearch({
          filters: { key: [questKey], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (!qres.data.data.length) continue;
        const qrec = qres.data.data[0];
        const qdata = JSON.parse(qrec.value);
        if (qdata.completed && !qdata.claimed) {
          qdata.claimed = true;

          const amount = rewardFor(type);
          if (amount > 0) {
            await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(
              gameServerId,
              playerId,
              { currency: amount }
            );
            totalBeers += amount;
            claimedCount += 1;
          }

          await takaro.variable.variableControllerUpdate(qrec.id, { value: JSON.stringify(qdata) });
        }
      } catch {
        // skip errors per quest
      }
    }

    // Clean pending list: remove processed types
    if (claimedCount > 0) {
      try {
        const remaining = items.filter((i) => !readyTypes.includes(String(i.type)));
        if (remaining.length) {
          await takaro.variable.variableControllerUpdate(pv.id, { value: JSON.stringify({ items: remaining }) });
        } else {
          await takaro.variable.variableControllerDelete(pv.id);
        }
      } catch { }

      // PM summary to player
      try {
        const playerName = await getPlayerName(playerId);
        const header = `${AWARD_WRAP} Quest reward awarded ${AWARD_WRAP}`;
        const questWord = pluralize(claimedCount, 'quest', 'quests');
        const msg = `${header} — ${claimedCount} ${questWord} completed — ${totalBeers} beers have been deposited to your account.`;
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
          command: `pm "${playerName}" "${msg}"`
        });
      } catch { }
    }
  }
}

await main();
