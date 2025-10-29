// FILE: playerDisconnect.js (v0.3.1) - minutes-aware targets (backward compatible)
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
function pragueDateString() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
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
function numOrUndef(val) { const n = Number(val); return Number.isNaN(n) ? undefined : n; }
function minutesOrMs(minKey, msKey, defaultMs) {
    const m = numOrUndef(cfgGet(minKey, undefined));
    if (m !== undefined) return m * 60000;
    const ms = numOrUndef(cfgGet(msKey, undefined));
    if (ms !== undefined) return ms;
    return defaultMs;
}

async function main() {
    const { player, gameServerId, module: mod } = data;
    if (!player) return;
    const enableTimeTracking = !!cfgGet('enableTimeTracking', true);
    if (!enableTimeTracking) return;

    const playerId = player.id;
    const date = pragueDateString();
    const now = Date.now();

    // timespent
    try {
        const sk = `session_${playerId}_${date}`;
        const sres = await takaro.variable.variableControllerSearch({
            filters: { key: [sk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (sres.data.data.length) {
            const sv = sres.data.data[0];
            const sess = JSON.parse(sv.value);
            if (sess.startTime) {
                sess.totalTime = (sess.totalTime || 0) + (now - sess.startTime);
                sess.startTime = null;
                sess.lastUpdate = now;
                await takaro.variable.variableControllerUpdate(sv.id, { value: JSON.stringify(sess) });
                const qk = `dailyquest_${playerId}_${date}_timespent`;
                const qres = await takaro.variable.variableControllerSearch({
                    filters: { key: [qk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
                });
                if (qres.data.data.length) {
                    const qv = qres.data.data[0];
                    const q = JSON.parse(qv.value);
                    q.progress = sess.totalTime;
                    const target = minutesOrMs('targets.timespentMinutes', 'targets.timespentMs', 3600000);
                    q.completed = q.progress >= target ? true : !!q.completed;
                    await takaro.variable.variableControllerUpdate(qv.id, { value: JSON.stringify(q) });
                }
            }
        }
    } catch { }

    // unkillable
    try {
        const dk = `deathless_session_${playerId}_${date}`;
        const dres = await takaro.variable.variableControllerSearch({
            filters: { key: [dk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (dres.data.data.length) {
            const dv = dres.data.data[0];
            const sess = JSON.parse(dv.value);
            if (sess.startTime) {
                sess.totalTime = (sess.totalTime || 0) + (now - sess.startTime);
                sess.startTime = null;
                sess.lastUpdate = now;
                await takaro.variable.variableControllerUpdate(dv.id, { value: JSON.stringify(sess) });
            }
            const qk = `dailyquest_${playerId}_${date}_unkillable`;
            const qres = await takaro.variable.variableControllerSearch({
                filters: { key: [qk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
            });
            if (qres.data.data.length) {
                const qv = qres.data.data[0];
                const q = JSON.parse(qv.value);
                const progress = sess.totalTime || 0;
                q.progress = progress;
                const target = minutesOrMs('targets.unkillableMinutes', 'targets.unkillableMs', 10800000);
                q.completed = progress >= target ? true : !!q.completed;
                await takaro.variable.variableControllerUpdate(qv.id, { value: JSON.stringify(q) });
            }
        }
    } catch { }
}

await main();
