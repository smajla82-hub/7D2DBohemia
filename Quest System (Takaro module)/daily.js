// =====================================
// FILE: daily.js (v0.2.0 single-PM, rotation aware)
// Minor tweak: header total = activeTypes.length (not number of existing variables)
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const TITLE_ICON = '✪';
const QUEST_BULLET = '※';
const READY_ICON = '✔';
const CLAIMED_LABEL = 'CLAIMED';

const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';

const POOL = [
    { type: 'timespent', target: 3600000 },
    { type: 'zombiekills', target: 200 },
    { type: 'levelgain', target: 5 },
    { type: 'shopquest', target: 1 },
    { type: 'unkillable', target: 10800000 },
    { type: 'feralkills', target: 10 },
    { type: 'vulturekills', target: 10 },
    { type: 'dieonce', target: 1 },
];
const ALWAYS = ['vote'];
const TOTAL_DAILY = 5;

function getPragueDateString() {
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
    const yyyy = local.getFullYear();
    const mm = String(local.getMonth() + 1).padStart(2, '0');
    const dd = String(local.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function deterministicSelection(dateStr, gameServerId) {
    const need = Math.max(0, TOTAL_DAILY - ALWAYS.length);
    const seed = hashString(`${dateStr}#${gameServerId}`);
    const rng = mulberry32(seed);
    const poolCopy = [...POOL];
    for (let i = poolCopy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [poolCopy[i], poolCopy[j]] = [poolCopy[j], poolCopy[i]];
    }
    const chosen = poolCopy.slice(0, Math.min(need, poolCopy.length)).map((p) => p.type);
    return [...ALWAYS, ...chosen];
}

function msToHMCompact(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0 && m > 0) return `${h}h${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

async function pm(gameServerId, playerName, text) {
    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
        command: `pm "${playerName}" "${text}"`,
    });
}

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const playerId = (pog && pog.playerId) ? pog.playerId : player.id;
    const playerName = player.name;
    const today = getPragueDateString();

    // Read active types (fallback deterministic if missing)
    let activeTypes = deterministicSelection(today, gameServerId);
    try {
        const res = await takaro.variable.variableControllerSearch({
            filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] },
        });
        if (res.data.data.length) {
            const payload = JSON.parse(res.data.data[0].value);
            if (payload?.date === today && Array.isArray(payload.types)) {
                activeTypes = payload.types;
            }
        }
    } catch { }

    const questNames = {
        timespent: 'TIME SURVIVOR',
        vote: 'SERVER SUPPORTER',
        zombiekills: 'ZOMBIE HUNTER',
        levelgain: 'EXPERIENCE GRINDER',
        shopquest: 'TRADE BEERS',
        unkillable: 'UNKILLABLE',
        feralkills: 'FERAL WHO?',
        vulturekills: 'COME DOWN!',
        dieonce: 'DEATH? I DONT CARE',
    };

    const quests = [];
    for (const type of activeTypes) {
        try {
            const questVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: [`dailyquest_${playerId}_${today}_${type}`],
                    gameServerId: [gameServerId],
                    playerId: [playerId],
                    moduleId: [mod.moduleId],
                },
            });
            if (questVar?.data?.data?.length > 0) {
                const record = questVar.data.data[0];
                let qd;
                try {
                    qd = JSON.parse(record.value);
                } catch {
                    qd = null;
                }
                if (qd && typeof qd === 'object') {
                    quests.push({ type, data: qd });
                }
            }
        } catch { }
    }

    const total = activeTypes.length; // header shows planned daily total
    const claimedCount = quests.reduce((acc, q) => acc + (q.data.claimed ? 1 : 0), 0);

    const header = `${TITLE_ICON} DAILY QUESTS ${claimedCount}/${total} ${TITLE_ICON}`;
    const parts = [];
    for (const q of quests) {
        const name = questNames[q.type] || q.type.toUpperCase();
        let progressText = '';
        if (q.type === 'timespent' || q.type === 'unkillable') {
            const prog = msToHMCompact(q.data.progress || 0);
            const targ = msToHMCompact(q.data.target || 0);
            progressText = `${prog}/${targ}`;
        } else {
            const prog = q.data.progress || 0;
            const targ = q.data.target || 0;
            progressText = `${prog}/${targ}`;
        }
        let state = '';
        if (q.data.claimed) state = CLAIMED_LABEL;
        else if (q.data.completed) state = `${READY_ICON} READY`;
        else state = 'in progress';
        parts.push(`※ ${name}: ${progressText} • ${state}`);
    }

    const message = [header, ...parts].join('  ');
    await pm(gameServerId, playerName, message);
}

await main();
