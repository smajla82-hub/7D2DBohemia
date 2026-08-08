// FILE: questTrackerKills.js (v0.4.1)
// - v0.4.1: Updated pm() to pm2 syntax + quoteIfNeeded; fixed mojibake (? -> ✔) in notify message
// - Dedicated lightweight cron for entity-killed processing only
// - zombiekills / feralkills / vulturekills
// - per-player cursor + overlap + dedupe

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const RETENTION_DEFAULT_DAYS = 7;

const KILL_CURSOR_PREFIX = 'questTracker_last_kill_ts_';
const KILL_DEDUPE_PREFIX = 'questTracker_seen_kill_ids_';
const KILL_CURSOR_OVERLAP_MS = 30_000;

const BUDGET_MS = 10_000;
const EVENT_LIMIT = 1000;

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
        const i = path.indexOf('.');
        if (i > 0) {
            const head = path.slice(0, i), tail = path.slice(i + 1);
            const obj = get(head);
            if (obj && typeof obj === 'object' && obj[tail] !== undefined) return obj[tail];
        }
    } catch { }
    return fallback;
}
function num(v, def) { const n = Number(v); return Number.isNaN(n) ? def : n; }
function retentionDays() { return num(cfgGet('retentionDays', RETENTION_DEFAULT_DAYS), RETENTION_DEFAULT_DAYS); }
function targetCount(type) {
    const d = { zombiekills: 200, feralkills: 10, vulturekills: 10 };
    return num(cfgGet(`targets.${type}`, d[type]), d[type]);
}

const DISPLAY = { zombiekills: 'ZOMBIE HUNTER', feralkills: 'FERAL WHO?', vulturekills: 'COME DOWN!' };

const PM_CHANNEL = 'Brewer';
function quoteIfNeeded(text) {
    return /\s/.test(text) ? `"${String(text).replace(/"/g, '\\"')}"` : String(text);
}
async function pm(gsId, name, text) {
    try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `pm2 ${PM_CHANNEL} ${name} ${quoteIfNeeded(text)}` }); } catch { }
}
async function getPlayerName(gsId, pogId) {
    try {
        const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gsId, pogId)).data.data;
        const p = await takaro.player.playerControllerGetOne(pog.playerId);
        return p.data.data.name;
    } catch { return null; }
}
async function notifyComplete(gsId, pid, type) {
    const name = await getPlayerName(gsId, pid);
    if (!name) return;
    await pm(gsId, name, `✔ ${(DISPLAY[type] || type.toUpperCase())} complete! Reward will be claimed shortly.`);
}

async function fetchEvents(gsId, sinceISO) {
    try {
        const r = await takaro.event.eventControllerSearch({
            filters: { eventName: ['entity-killed'], gameserverId: [gsId] },
            greaterThan: { createdAt: sinceISO },
            limit: EVENT_LIMIT
        });
        return r.data.data || [];
    } catch { return []; }
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
async function addToSet(gsId, moduleId, setKey, item, expiresAtISO, playerId) {
    const v = await getVar(gsId, moduleId, setKey, playerId);
    if (!v) {
        await upsertRaw(gsId, moduleId, setKey, JSON.stringify([item]), expiresAtISO, playerId);
        return true;
    }
    let arr; try { arr = JSON.parse(v.value); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    if (arr.includes(item)) return false;
    arr.push(item);
    try { await takaro.variable.variableControllerUpdate(v.id, { value: JSON.stringify(arr), expiresAt: expiresAtISO }); } catch { }
    return true;
}

async function getQuestVar(gsId, moduleId, playerId, date, type) {
    const key = `dailyquest_${playerId}_${date}_${type}`;
    return await getVar(gsId, moduleId, key, playerId);
}
async function saveQuestVar(id, payload) {
    try { await takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(payload) }); } catch { }
}

function classifyKill(e) {
    const entity = String(e?.meta?.entity || '').toLowerCase();
    const isZombie = entity.length > 0 && entity !== 'player' && entity !== 'animal';
    const isFeral = entity.includes('feral');
    const isVulture = entity.includes('zombie vulture') || (entity.includes('vulture') && entity !== 'vulture');
    const isZombieDog = entity.includes('zombie dog') || (entity.includes('dog') && entity.includes('zombie'));
    return { isZombie, isFeral, isVulture: isVulture || isZombieDog };
}

async function main() {
    const t0 = Date.now();
    const within = () => Date.now() - t0 < BUDGET_MS;

    const gsId = data.gameServerId;
    const moduleId = data.module.moduleId;
    const date = ymd();
    const expISO = addDaysISO(nowPrague(), retentionDays());

    const players = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [gsId], online: [true] },
        limit: 500
    });

    for (const p of (players?.data?.data || [])) {
        if (!within()) break;

        const pid = String(p.playerId || '');
        if (!pid) continue;

        const cursorKey = `${KILL_CURSOR_PREFIX}${pid}`;
        const last = await getVar(gsId, moduleId, cursorKey, null);
        const lastISO = (last && String(last.value || '').trim()) ? String(last.value).trim() : new Date(Date.now() - 5 * 60 * 1000).toISOString();

        const overlapISO = new Date(new Date(lastISO).getTime() - KILL_CURSOR_OVERLAP_MS).toISOString();
        const events = await fetchEvents(gsId, overlapISO);

        let maxISO = lastISO;

        for (const e of events) {
            if (!within()) break;
            if (String(e.playerId || '') !== pid) continue;

            const evtId = String(e.id || '');
            if (evtId) {
                const dedupeKey = `${KILL_DEDUPE_PREFIX}${pid}_${date}`;
                const ok = await addToSet(gsId, moduleId, dedupeKey, evtId, expISO, pid);
                if (!ok) continue;
            }

            const { isZombie, isFeral, isVulture } = classifyKill(e);

            if (isZombie) {
                const v = await getQuestVar(gsId, moduleId, pid, date, 'zombiekills');
                if (v) {
                    let q; try { q = JSON.parse(v.value); } catch { q = null; }
                    if (q && !q.completed) {
                        const tgt = targetCount('zombiekills'); q.target ||= tgt;
                        q.progress = (q.progress || 0) + 1;
                        if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'zombiekills'); }
                        await saveQuestVar(v.id, q);
                    }
                }
            }

            if (isFeral) {
                const v = await getQuestVar(gsId, moduleId, pid, date, 'feralkills');
                if (v) {
                    let q; try { q = JSON.parse(v.value); } catch { q = null; }
                    if (q && !q.completed) {
                        const tgt = targetCount('feralkills'); q.target ||= tgt;
                        q.progress = (q.progress || 0) + 1;
                        if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'feralkills'); }
                        await saveQuestVar(v.id, q);
                    }
                }
            }

            if (isVulture) {
                const v = await getQuestVar(gsId, moduleId, pid, date, 'vulturekills');
                if (v) {
                    let q; try { q = JSON.parse(v.value); } catch { q = null; }
                    if (q && !q.completed) {
                        const tgt = targetCount('vulturekills'); q.target ||= tgt;
                        q.progress = (q.progress || 0) + 1;
                        if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'vulturekills'); }
                        await saveQuestVar(v.id, q);
                    }
                }
            }

            const cISO = String(e.createdAt || '');
            if (cISO && cISO > maxISO) maxISO = cISO;
        }

        if (maxISO && maxISO !== lastISO) {
            await upsertRaw(gsId, moduleId, cursorKey, maxISO, expISO, null);
        }
    }
}

await main();