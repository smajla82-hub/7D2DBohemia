// FILE: autoClaimPendingRewards.js (v0.1.2)
// - v0.1.2: Updated pm() to pm2 syntax + quoteIfNeeded; fixed mojibake (? -> ✔) in reward message
// - Pays queued rewards from autoclaim_pending_<playerId>_<date>
// - Marks items as paid=true after successful payout
// Suggested schedule: */1 * * * *  (every minute)

import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const AUT_CLAIM_PREFIX = 'autoclaim_pending_';
const RETENTION_DEFAULT_DAYS = 7;
const BUDGET_MS = 8000;

function nowPrague() { return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE })); }
function ymd(d = nowPrague()) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
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
function addDaysISO(d, days) { return new Date(d.getTime() + days * 86400 * 1000).toISOString(); }

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

async function main() {
    const t0 = Date.now();
    const within = () => Date.now() - t0 < BUDGET_MS;

    const gsId = data.gameServerId;
    const moduleId = data.module.moduleId;
    const today = ymd();
    const expISO = addDaysISO(nowPrague(), retentionDays());

    // Find pending vars (module-wide). Limit 1000.
    const res = await takaro.variable.variableControllerSearch({
        filters: { gameServerId: [gsId], moduleId: [moduleId] },
        limit: 1000
    });

    for (const v of (res?.data?.data || [])) {
        if (!within()) break;
        if (typeof v.key !== 'string') continue;
        if (!v.key.startsWith(AUT_CLAIM_PREFIX)) continue;
        if (!v.key.endsWith(`_${today}`)) continue;

        const playerId = String(v.playerId || '');
        if (!playerId) continue;

        let arr;
        try { arr = JSON.parse(v.value); } catch { arr = null; }
        if (!Array.isArray(arr) || !arr.length) continue;

        let changed = false;

        for (const item of arr) {
            if (!within()) break;
            if (!item || item.paid) continue;

            // only support beers for now
            const beers = Number(item.beers);
            if (!Number.isFinite(beers) || beers <= 0) {
                item.paid = true;
                changed = true;
                continue;
            }

            try {
                await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gsId, playerId, { currency: beers });
                item.paid = true;
                item.paidAt = new Date().toISOString();
                changed = true;

                const name = await getPlayerName(gsId, playerId);
                if (name) await pm(gsId, name, `✔ Bonus reward claimed: ${beers} beers.`);
            } catch {
                // leave it for retry next run
            }
        }

        if (changed) {
            try { await takaro.variable.variableControllerUpdate(v.id, { value: JSON.stringify(arr), expiresAt: expISO }); } catch { }
        }
    }
}

await main();