// FILE: questTrackerTime.js (v0.4.3)
// - v0.4.3: Cron no longer auto-resumes paused session_* variables; only ticks running sessions
// - v0.4.2: Updated pm() to pm2 syntax + quoteIfNeeded; fixed mojibake (? -> ✔) in notify message
// Fix UNKILLABLE: use deathless_session_* instead of deathless_start_*

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
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
function minutesOrMs(minKey, msKey, defMs) {
    const min = Number(cfgGet(minKey, undefined));
    if (!Number.isNaN(min) && min !== undefined) return Math.max(0, min) * 60000;
    const ms = Number(cfgGet(msKey, undefined));
    return (!Number.isNaN(ms) && ms !== undefined) ? Math.max(0, ms) : defMs;
}
function targetMs(type) {
    if (type === 'timespent') return minutesOrMs('targets.timespentMinutes', 'targets.timespentMs', 3600000);
    if (type === 'unkillable') return minutesOrMs('targets.unkillableMinutes', 'targets.unkillableMs', 10800000);
    return 0;
}

const PM_CHANNEL = 'Brewer';
function quoteIfNeeded(text) {
    return /\s/.test(text) ? `"${String(text).replace(/"/g, '\\"')}"` : String(text);
}
async function pm(gsId, name, text) {
    try { await takaro.gameserver.gameServerControllerExecuteCommand(gsId, { command: `pm2 ${PM_CHANNEL} ${name} ${quoteIfNeeded(text)}` }); } catch { }
}
async function getPlayerName(gsId, playerId) {
    try {
        const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gsId, playerId)).data.data;
        const p = await takaro.player.playerControllerGetOne(pog.playerId);
        return p.data.data.name;
    } catch { return null; }
}
async function notifyComplete(gsId, playerId, type) {
    const name = await getPlayerName(gsId, playerId);
    if (!name) return;
    const nice = type === 'timespent' ? 'TIME SURVIVOR' : 'UNKILLABLE';
    await pm(gsId, name, `✔ ${nice} complete! Reward will be claimed shortly.`);
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

async function getQuestVar(gsId, moduleId, playerId, date, type) {
    const key = `dailyquest_${playerId}_${date}_${type}`;
    return await getVar(gsId, moduleId, key, playerId);
}
async function ensureQuestVar(gsId, moduleId, playerId, date, type) {
    const found = await getQuestVar(gsId, moduleId, playerId, date, type);
    if (found) return found;
    const payload = { type, target: targetMs(type), progress: 0, completed: false, claimed: false, date, createdAt: new Date().toISOString() };
    const created = await takaro.variable.variableControllerCreate({
        key: `dailyquest_${playerId}_${date}_${type}`,
        value: JSON.stringify(payload),
        gameServerId: gsId,
        moduleId,
        playerId: String(playerId)
    });
    return created.data.data;
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

        const now = Date.now();

        // ---- TIME SURVIVOR session + quest ----
        const sessionKey = `session_${pid}_${date}`;
        const sVar = await getVar(gsId, moduleId, sessionKey, pid);

        let sess = null;
        if (sVar) { try { sess = JSON.parse(sVar.value); } catch { sess = null; } }
        if (!sess || typeof sess !== 'object') sess = { startTime: now, totalTime: 0, lastUpdate: now };

        if (sess.startTime) {
            const last = Number(sess.lastUpdate || sess.startTime || now);
            sess.totalTime = Number(sess.totalTime || 0) + Math.max(0, now - last);
            sess.lastUpdate = now;
        }

        if (sVar && sess.startTime) {
            try { await takaro.variable.variableControllerUpdate(sVar.id, { value: JSON.stringify(sess), expiresAt: expISO }); } catch { }
        } else if (sVar) {
            // Paused sessions stay paused until playerConnect resumes them.
        } else {
            try {
                await takaro.variable.variableControllerCreate({
                    key: sessionKey,
                    value: JSON.stringify(sess),
                    gameServerId: gsId,
                    moduleId,
                    playerId: String(pid),
                    expiresAt: expISO
                });
            } catch { }
        }

        const tQuest = await ensureQuestVar(gsId, moduleId, pid, date, 'timespent');
        if (tQuest) {
            let q; try { q = JSON.parse(tQuest.value); } catch { q = null; }
            if (q && !q.completed) {
                q.progress = Number(sess.totalTime || 0);
                const tgt = targetMs('timespent'); q.target ||= tgt;
                if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'timespent'); }
                try { await takaro.variable.variableControllerUpdate(tQuest.id, { value: JSON.stringify(q) }); } catch { }
            }
        }

        // ---- UNKILLABLE: use deathless_session_* ----
        const deathlessKey = `deathless_session_${pid}_${date}`;
        const dVar = await getVar(gsId, moduleId, deathlessKey, pid);

        let d = null;
        if (dVar) { try { d = JSON.parse(dVar.value); } catch { d = null; } }
        if (!d || typeof d !== 'object') d = { startTime: now, totalTime: 0, lastUpdate: now };

        // Tick only when actively "running" (startTime not null)
        if (d.startTime) {
            const last = Number(d.lastUpdate || d.startTime || now);
            d.totalTime = Number(d.totalTime || 0) + Math.max(0, now - last);
            d.lastUpdate = now;

            try { await takaro.variable.variableControllerUpdate(dVar?.id, { value: JSON.stringify(d), expiresAt: expISO }); } catch { }
        }

        const uQuest = await ensureQuestVar(gsId, moduleId, pid, date, 'unkillable');
        if (uQuest) {
            let q; try { q = JSON.parse(uQuest.value); } catch { q = null; }
            if (q && !q.completed) {
                q.progress = Number(d.totalTime || 0);
                const tgt = targetMs('unkillable'); q.target ||= tgt;
                if (q.progress >= tgt) { q.completed = true; await notifyComplete(gsId, pid, 'unkillable'); }
                try { await takaro.variable.variableControllerUpdate(uQuest.id, { value: JSON.stringify(q) }); } catch { }
            }
        }
    }
}

await main();