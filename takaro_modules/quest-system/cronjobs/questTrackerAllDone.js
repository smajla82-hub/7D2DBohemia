// FILE: questTrackerAllDone.js (v0.4.1)
// - Checks "all daily quests completed" for ONLINE players only (fast/reliable)
// - Creates dailyquests_all_done_<pid>_<date>
// - Queues a pending payout in autoclaim_pending_<pid>_<date>
// Suggested schedule: */1 * * * *   (every minute is fine; it's cheap now)

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const ALL_DONE_KEY_PREFIX = 'dailyquests_all_done_';
const AUT_CLAIM_PREFIX = 'autoclaim_pending_';
const RETENTION_DEFAULT_DAYS = 7;
const BUDGET_MS = 8000;

function nowPrague() { return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE })); }
function ymd(d = nowPrague()) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function addDaysISO(d, days) { return new Date(d.getTime() + days * 86400 * 1000).toISOString(); }

function cfgGet(path, fallback) {
    try {
        const get = data?.config?.get?.bind(data.config);
        if (!get) return fallback;
        const v = get(path);
        if (v !== undefined && v !== null && String(v).trim?.() !== '') return v;
    } catch { }
    return fallback;
}
function num(v, def) { const n = Number(v); return Number.isNaN(n) ? def : n; }
function retentionDays() { return num(cfgGet('retentionDays', RETENTION_DEFAULT_DAYS), RETENTION_DEFAULT_DAYS); }

// configure your all-done reward here (beers)
function allDoneBeers() { return num(cfgGet('rewards.allDoneBeers', 200), 200); }

async function pm(gsId, name, text) {
    try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `pm "${name}" "${text}"` }); } catch { }
}
async function say(gsId, text) {
    try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `say "${text}"` }); } catch { }
}

async function getVar(gsId, moduleId, key, playerId) {
    const s = await takaro.variable.variableControllerSearch({
        filters: {
            key: [key],
            gameServerId: [gsId],
            moduleId: [moduleId],
            ...(playerId ? { playerId: [String(playerId)] } : {})
        },
        limit: 1
    });
    return s.data.data.length ? s.data.data[0] : null;
}
async function upsertRaw(gsId, moduleId, key, value, expiresAtISO, playerId) {
    const existing = await getVar(gsId, moduleId, key, playerId);
    if (existing) {
        try { await takaro.variable.variableControllerUpdate(existing.id, { value: String(value), expiresAt: expiresAtISO }); } catch { }
        return;
    }
    try {
        await takaro.variable.variableControllerCreate({
            key,
            value: String(value),
            gameServerId: gsId,
            moduleId,
            ...(playerId ? { playerId: String(playerId) } : {}),
            expiresAt: expiresAtISO
        });
    } catch { }
}
async function upsertJsonAppendArray(gsId, moduleId, playerId, key, item, expiresAtISO) {
    const v = await getVar(gsId, moduleId, key, playerId);
    if (!v) {
        await upsertRaw(gsId, moduleId, key, JSON.stringify([item]), expiresAtISO, playerId);
        return;
    }
    let arr; try { arr = JSON.parse(v.value); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(item);
    try { await takaro.variable.variableControllerUpdate(v.id, { value: JSON.stringify(arr), expiresAt: expiresAtISO }); } catch { }
}

async function getActiveTypesToday(gsId, moduleId, today) {
    try {
        const res = await takaro.variable.variableControllerSearch({
            filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gsId], moduleId: [moduleId] }
        });
        if (res.data.data.length) {
            const p = JSON.parse(res.data.data[0].value);
            if (p?.date === today && Array.isArray(p.types)) return p.types;
        }
    } catch { }
    return ['vote', 'levelgain', 'timespent', 'zombiekills', 'unkillable'];
}

async function isQuestCompleted(gsId, moduleId, playerId, date, type) {
    const key = `dailyquest_${playerId}_${date}_${type}`;
    const v = await getVar(gsId, moduleId, key, playerId);
    if (!v) return false;
    try { return !!JSON.parse(v.value)?.completed; } catch { return false; }
}

async function getPlayerName(gsId, pogId) {
    try {
        const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gsId, pogId)).data.data;
        const p = await takaro.player.playerControllerGetOne(pog.playerId);
        return p.data.data.name;
    } catch { return null; }
}

async function main() {
    const t0 = Date.now();
    const within = () => Date.now() - t0 < BUDGET_MS;

    const gsId = data.gameServerId;
    const moduleId = data.module.moduleId;
    const today = ymd();
    const expISO = addDaysISO(nowPrague(), retentionDays());

    const activeTypes = await getActiveTypesToday(gsId, moduleId, today);
    const rewardBeers = allDoneBeers();

    // ONLINE ONLY (fast)
    const players = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [gsId], online: [true] },
        limit: 500
    });

    for (const p of (players?.data?.data || [])) {
        if (!within()) break;

        const pid = String(p.playerId || '');
        if (!pid) continue;

        const doneKey = `${ALL_DONE_KEY_PREFIX}${pid}_${today}`;
        const already = await getVar(gsId, moduleId, doneKey, pid);
        if (already) continue;

        let ok = true;
        for (const type of activeTypes) {
            if (!within()) { ok = false; break; }
            const completed = await isQuestCompleted(gsId, moduleId, pid, today, type);
            if (!completed) { ok = false; break; }
        }
        if (!ok) continue;

        // mark done once
        await upsertRaw(gsId, moduleId, doneKey, String(Date.now()), expISO, pid);

        // queue payout
        const autoKey = `${AUT_CLAIM_PREFIX}${pid}_${today}`;
        await upsertJsonAppendArray(gsId, moduleId, pid, autoKey, {
            type: 'allcomplete',
            beers: rewardBeers,
            paid: false,
            date: today,
            createdAt: new Date().toISOString()
        }, expISO);

        const name = (await getPlayerName(gsId, pid)) || 'Player';
        await say(gsId, `? HUGE EFFORT BY ${name} FOR FINISHING ALL DAILY QUESTS TODAY — YOU EARNED A KEG OF BEER AS A REWARD! ?`);
        await pm(gsId, name, `? All Daily quests done! Bonus ${rewardBeers} beers will be claimed shortly.`);
    }
}

await main();