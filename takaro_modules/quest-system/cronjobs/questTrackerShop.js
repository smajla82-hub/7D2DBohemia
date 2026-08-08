// FILE: questTrackerShop.js (v0.4.0)
// - Dedicated cron for shopquest tracking
// - Processes shop-order-status-changed and currency-deducted with dedupe
// Suggested schedule: */2 * * * *

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const LAST_RUN_KEY = 'questTrackerShop_last_run';
const SHOP_CURRENCY_PROCESSED_PREFIX = 'shopquest_currency_processed_';
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
function targetCount() { return num(cfgGet('targets.shopquest', 1), 1); }

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

async function getQuestVar(gsId, moduleId, playerId, date) {
    const key = `dailyquest_${playerId}_${date}_shopquest`;
    return await getVar(gsId, moduleId, key, playerId);
}
async function saveQuestVar(id, payload) { try { await takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(payload) }); } catch { } }

function isCompletedShop(e) {
    const s = String((e && e.meta && e.meta.status) || (e && e.payload && e.payload.status) || '').toUpperCase();
    return s === 'COMPLETED' || s === 'SUCCESS' || s === 'DONE';
}

async function fetchEvents(gsId, eventName, sinceISO, limit) {
    try {
        const r = await takaro.event.eventControllerSearch({
            filters: { eventName: [eventName], gameserverId: [gsId] },
            greaterThan: { createdAt: sinceISO },
            limit
        });
        return r.data.data || [];
    } catch { return []; }
}

async function main() {
    const t0 = Date.now();
    const within = () => Date.now() - t0 < BUDGET_MS;

    const gsId = data.gameServerId;
    const moduleId = data.module.moduleId;
    const date = ymd();
    const expISO = addDaysISO(nowPrague(), retentionDays());

    let lastRun = new Date(Date.now() - 10 * 60 * 1000);
    try {
        const r = await getVar(gsId, moduleId, LAST_RUN_KEY, null);
        if (r?.value) lastRun = new Date(String(r.value));
    } catch { }
    const sinceISO = lastRun.toISOString();

    // shop-order-status-changed
    if (within()) {
        const shops = await fetchEvents(gsId, 'shop-order-status-changed', sinceISO, 300);
        for (const e of shops) {
            if (!within()) break;
            const pid = String(e.playerId || '');
            if (!pid) continue;
            if (!isCompletedShop(e)) continue;

            const v = await getQuestVar(gsId, moduleId, pid, date);
            if (!v) continue;

            let q; try { q = JSON.parse(v.value); } catch { q = null; }
            if (!q || q.completed) continue;

            const tgt = targetCount(); q.target ||= tgt;
            q.progress = (q.progress || 0) + 1;
            if (q.progress >= tgt) q.completed = true;

            await saveQuestVar(v.id, q);
        }
    }

    // currency-deducted (dedupe)
    if (within()) {
        const curr = await fetchEvents(gsId, 'currency-deducted', sinceISO, 1000);
        for (const e of curr) {
            if (!within()) break;
            const pid = String(e.playerId || '');
            if (!pid) continue;

            const evtId = String(e.id || '');
            if (!evtId) continue;

            const setKey = `${SHOP_CURRENCY_PROCESSED_PREFIX}${pid}_${date}`;
            const ok = await addToSet(gsId, moduleId, setKey, evtId, expISO, pid);
            if (!ok) continue;

            const v = await getQuestVar(gsId, moduleId, pid, date);
            if (!v) continue;

            let q; try { q = JSON.parse(v.value); } catch { q = null; }
            if (!q || q.completed) continue;

            const tgt = targetCount(); q.target ||= tgt;
            q.progress = (q.progress || 0) + 1;
            if (q.progress >= tgt) q.completed = true;

            await saveQuestVar(v.id, q);
        }
    }

    await upsertRaw(gsId, moduleId, LAST_RUN_KEY, new Date().toISOString(), expISO, null);
}

await main();