// =====================================
// FILE: voteQuestRepair.js (v0.2.0)
// - Pagination (page, limit<=1000)
// - Repairs wrongly dated keys for VOTE and LEVELGAIN written today
// - Migrates progress into today's correct key and deletes stale key
// - Audit log stored in vote_repair_log (keeps last 100 entries)
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const REPAIR_LOG_KEY = 'vote_repair_log';
const TYPES_TO_REPAIR = new Set(['vote', 'levelgain']);
const PAGE_SIZE = 1000;

function nowPrague() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
}
function todayStr() {
    const d = nowPrague();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfToday() {
    const d = nowPrague();
    d.setHours(0, 0, 0, 0);
    return d;
}
async function appendLog(gsId, moduleId, lines) {
    try {
        const s = await takaro.variable.variableControllerSearch({
            filters: { key: [REPAIR_LOG_KEY], gameServerId: [gsId], moduleId: [moduleId] }, limit: 1
        });
        let arr = [];
        if (s.data.data.length) {
            try { arr = JSON.parse(s.data.data[0].value); } catch { }
            if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
            arr.push(...lines);
            arr = arr.slice(-100);
            await takaro.variable.variableControllerUpdate(s.data.data[0].id, { value: JSON.stringify(arr) });
        } else {
            await takaro.variable.variableControllerCreate({ key: REPAIR_LOG_KEY, value: JSON.stringify(lines), gameServerId: gsId, moduleId });
        }
    } catch { }
}
async function getVarByKey(gsId, moduleId, key, playerId) {
    const s = await takaro.variable.variableControllerSearch({
        filters: { key: [key], gameServerId: [gsId], moduleId: [moduleId], playerId: playerId ? [playerId] : undefined }, limit: 1
    });
    return s.data.data.length ? s.data.data[0] : null;
}

async function main() {
    const gsId = data.gameServerId;
    const moduleId = data.module.moduleId;
    const today = todayStr();
    const todayStart = startOfToday();
    const log = [`run:${new Date().toISOString()}`, `today:${today}`];

    let scanned = 0, migrated = 0, skipped = 0, page = 0;

    while (true) {
        let batch = [];
        try {
            const r = await takaro.variable.variableControllerSearch({
                filters: { gameServerId: [gsId], moduleId: [moduleId] },
                limit: PAGE_SIZE,
                page
            });
            batch = r.data.data || [];
        } catch {
            log.push(`fetch-failed-page:${page}`);
            break;
        }
        if (!batch.length) break;

        for (const v of batch) {
            if (!v.key || !v.key.startsWith('dailyquest_')) continue;
            const parts = v.key.split('_'); // dailyquest <playerId> <date> <type>
            if (parts.length < 4) { continue; }
            const playerId = parts[1];
            const datePart = parts[2];
            const typePart = parts[3];
            if (!TYPES_TO_REPAIR.has(typePart)) continue;

            scanned++;

            // Already correct key for today? skip.
            if (datePart === today) { skipped++; continue; }

            // Consider only variables touched today
            let createdAtDate = null; try { createdAtDate = new Date(v.createdAt); } catch { }
            let updatedAtDate = null; try { updatedAtDate = new Date(v.updatedAt); } catch { }
            const isTodayUse = (createdAtDate && createdAtDate >= todayStart) || (updatedAtDate && updatedAtDate >= todayStart);
            if (!isTodayUse) { skipped++; continue; }

            let payload = null; try { payload = JSON.parse(v.value); } catch { }
            if (!payload) { skipped++; continue; }

            const correctKey = `dailyquest_${playerId}_${today}_${typePart}`;
            const existingToday = await getVarByKey(gsId, moduleId, correctKey, playerId);

            // Build new/correct payload
            const defaultTargets = { vote: 1, levelgain: 5 };
            const newPayload = {
                type: typePart,
                target: payload.target ?? defaultTargets[typePart] ?? 1,
                progress: payload.progress ?? 0,
                completed: payload.completed ?? ((payload.progress ?? 0) >= (payload.target ?? (defaultTargets[typePart] ?? 1))),
                claimed: payload.claimed ?? false,
                date: today,
                createdAt: (payload.createdAt && new Date(payload.createdAt) >= todayStart) ? payload.createdAt : todayStart.toISOString(),
                lastUpdated: new Date().toISOString()
            };

            if (existingToday) {
                // Merge progress conservatively: keep max
                let ex = null; try { ex = JSON.parse(existingToday.value); } catch { }
                if (ex && typeof ex.progress === 'number' && ex.progress > newPayload.progress) {
                    newPayload.progress = ex.progress;
                    newPayload.completed = newPayload.progress >= (newPayload.target ?? 1);
                }
                await takaro.variable.variableControllerUpdate(existingToday.id, { value: JSON.stringify(newPayload) });
            } else {
                await takaro.variable.variableControllerCreate({
                    key: correctKey,
                    value: JSON.stringify(newPayload),
                    gameServerId: gsId,
                    playerId,
                    moduleId
                });
            }

            // Delete the stale variable
            try { await takaro.variable.variableControllerDelete(v.id); } catch { }
            migrated++;
        }

        // Next page
        if (batch.length < PAGE_SIZE) break;
        page++;
    }

    log.push(`scanned:${scanned}`, `migrated:${migrated}`, `skipped:${skipped}`, 'done');
    await appendLog(gsId, moduleId, log);
}

await main();