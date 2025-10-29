// =====================================
// FILE: playerDeath.js (v0.3.0)
// - Reset unkillable progress (deathless_session -> 0, restart from now)
// - Increment dieonce quest progress (complete at 1)
// =====================================
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

async function main() {
    const { player, gameServerId, module: mod } = data;
    if (!player) return;
    const playerId = player.id;
    const date = pragueDateString();
    const now = Date.now();

    // Reset deathless session
    try {
        const dk = `deathless_session_${playerId}_${date}`;
        const dres = await takaro.variable.variableControllerSearch({
            filters: { key: [dk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (dres.data.data.length) {
            const dv = dres.data.data[0];
            const newObj = { startTime: now, totalTime: 0, lastUpdate: now };
            await takaro.variable.variableControllerUpdate(dv.id, { value: JSON.stringify(newObj) });
        }
        // reflect into quest
        const qk = `dailyquest_${playerId}_${date}_unkillable`;
        const qres = await takaro.variable.variableControllerSearch({
            filters: { key: [qk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (qres.data.data.length) {
            const qv = qres.data.data[0];
            try {
                const q = JSON.parse(qv.value);
                q.progress = 0;
                q.completed = false;
                q.claimed = false;
                await takaro.variable.variableControllerUpdate(qv.id, { value: JSON.stringify(q) });
            } catch { }
        }
    } catch { }

    // Die-once quest: increment to 1 (complete)
    try {
        const qk = `dailyquest_${playerId}_${date}_dieonce`;
        const qres = await takaro.variable.variableControllerSearch({
            filters: { key: [qk], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (qres.data.data.length) {
            const qv = qres.data.data[0];
            const q = JSON.parse(qv.value);
            if (!q.completed) {
                q.progress = Math.min((q.progress || 0) + 1, q.target || Number(cfgGet('targets.dieonce', 1)));
                q.completed = q.progress >= (q.target || 1);
                await takaro.variable.variableControllerUpdate(qv.id, { value: JSON.stringify(q) });
            }
        }
    } catch { }
}

await main();
