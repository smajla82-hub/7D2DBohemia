// =====================================
// FILE: daily.js (v0.3.7)
// - Always render all active quest types.
//   If a variable is missing, render a phantom with target from config and progress=0.
// - Effective quest date: yesterday until daily reset runs, today after.
// - Module-agnostic display for vote/levelgain when not found under this module.
// - Stylized quest names.
// =====================================
import { takaro, data } from '@takaro/helpers';

const TIME_ZONE = 'Europe/Prague';
const TITLE_ICON = '✪';
const QUEST_BULLET = '※';
const READY_ICON = '✔';
const CLAIMED_LABEL = 'CLAIMED';

const DAILY_ACTIVE_TYPES_KEY = 'dailyquests_active_types';
const LAST_RESET_KEY = 'dailyquests_last_reset_at';

// External types updated by your integration service
const EXTERNALLY_UPDATED = new Set(['vote', 'levelgain']);

// Pool and rotation defaults (only used if we can't read the stored list)
const POOL_TYPES = ['timespent', 'zombiekills', 'shopquest', 'unkillable', 'feralkills', 'vulturekills', 'dieonce'];
const ALWAYS = ['vote', 'levelgain'];
const TOTAL_DAILY = 5;

// Stylized names
const QUEST_DISPLAY_NAMES = {
    timespent: 'TIME SURVIVOR',
    shopquest: 'TRADE BEERS',
    levelgain: 'EXPERIENCE GRINDER',
    zombiekills: 'ZOMBIE HUNTER',
    vote: 'SERVER SUPPORTER',
    unkillable: 'UNKILLABLE',
    feralkills: 'FERAL WHO?',
    vulturekills: 'COME DOWN!',
    dieonce: 'DEATH? I DONT CARE'
};

function pragueNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
}
function pragueDateString(d = pragueNow()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function pragueYesterdayString() {
    const d = pragueNow();
    d.setDate(d.getDate() - 1);
    return pragueDateString(d);
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
function deterministicSelection(dateStr, serverId) {
    const need = Math.max(0, TOTAL_DAILY - ALWAYS.length);
    const seed = hashString(`${dateStr}#${serverId}`);
    const rng = mulberry32(seed);
    const copy = [...POOL_TYPES];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const chosen = copy.slice(0, Math.min(need, copy.length));
    return [...ALWAYS, ...chosen];
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
function minutesToMs(m) { return Math.max(0, Number(m || 0)) * 60000; }

// Targets (from config) for display/phantoms
function targetForDisplay(type) {
    switch (type) {
        case 'timespent': {
            const m = numOrUndef(cfgGet('targets.timespentMinutes', undefined));
            const ms = numOrUndef(cfgGet('targets.timespentMs', undefined));
            return m !== undefined ? minutesToMs(m) : (ms !== undefined ? ms : 3600000);
        }
        case 'unkillable': {
            const m = numOrUndef(cfgGet('targets.unkillableMinutes', undefined));
            const ms = numOrUndef(cfgGet('targets.unkillableMs', undefined));
            return m !== undefined ? minutesToMs(m) : (ms !== undefined ? ms : 10800000);
        }
        case 'zombiekills': return numOrUndef(cfgGet('targets.zombiekills', 200)) ?? 200;
        case 'levelgain': return numOrUndef(cfgGet('targets.levelgain', 5)) ?? 5;
        case 'shopquest': return numOrUndef(cfgGet('targets.shopquest', 1)) ?? 1;
        case 'feralkills': return numOrUndef(cfgGet('targets.feralkills', 10)) ?? 10;
        case 'vulturekills': return numOrUndef(cfgGet('targets.vulturekills', 10)) ?? 10;
        case 'dieonce': return numOrUndef(cfgGet('targets.dieonce', 1)) ?? 1;
        case 'vote': return numOrUndef(cfgGet('targets.vote', 1)) ?? 1;
        default: return 1;
    }
}

function msToHMCompact(ms) {
    const total = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h${String(m).padStart(2, '0')}m`;
}

// Flexible lookup for a quest variable:
// 1) Try this moduleId.
// 2) If external type and not found, look across modules.
async function getQuestVarFlexible(gameServerId, moduleId, playerId, date, type) {
    const key = `dailyquest_${playerId}_${date}_${type}`;

    const own = await takaro.variable.variableControllerSearch({
        filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId], moduleId: [moduleId] }
    });
    if (own.data.data.length) return own.data.data[0];

    if (EXTERNALLY_UPDATED.has(type)) {
        const any = await takaro.variable.variableControllerSearch({
            filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId] }
        });
        if (any.data.data.length) return any.data.data[0];
    }
    return null;
}

async function pm(gameServerId, name, text) {
    try {
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, { command: `pm "${name}" "${text}"` });
    } catch { }
}

async function main() {
    const { player, gameServerId, module: mod } = data;
    const playerId = player.id;
    const name = player.name;

    const today = pragueDateString();
    // Show yesterday until global reset runs
    let lastReset = null;
    try {
        const s = await takaro.variable.variableControllerSearch({
            filters: { key: [LAST_RESET_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
        });
        if (s.data.data.length) lastReset = s.data.data[0].value;
    } catch { }
    const displayDate = (lastReset === today) ? today : pragueYesterdayString();

    // read active types for displayDate
    let activeTypes = [];
    try {
        const res = await takaro.variable.variableControllerSearch({
            filters: { key: [DAILY_ACTIVE_TYPES_KEY], gameServerId: [gameServerId], moduleId: [mod.moduleId] }
        });
        if (res.data.data.length) {
            const p = JSON.parse(res.data.data[0].value);
            if (p?.date === displayDate && Array.isArray(p.types)) activeTypes = p.types;
        }
    } catch { }
    if (!activeTypes.length) activeTypes = deterministicSelection(displayDate, gameServerId);

    // Build display list: prefer stored var; otherwise phantom using config target
    const quests = [];
    for (const type of activeTypes) {
        const v = await getQuestVarFlexible(gameServerId, mod.moduleId, playerId, displayDate, type);
        if (v) {
            try {
                const q = JSON.parse(v.value);
                quests.push({ type, data: q });
                continue;
            } catch { }
        }
        // Phantom with config-based target
        quests.push({
            type,
            data: { type, target: targetForDisplay(type), progress: 0, completed: false, claimed: false }
        });
    }

    const total = activeTypes.length;
    const claimedCount = quests.reduce((acc, q) => acc + (q.data.claimed ? 1 : 0), 0);

    const header = `${TITLE_ICON} DAILY QUESTS ${claimedCount}/${total} ${TITLE_ICON}`;
    const parts = [];
    for (const q of quests) {
        const nice = QUEST_DISPLAY_NAMES[q.type] || q.type.toUpperCase();
        let progressText = '';
        if (q.type === 'timespent' || q.type === 'unkillable') {
            progressText = `${msToHMCompact(q.data.progress || 0)}/${msToHMCompact(q.data.target || 0)}`;
        } else {
            progressText = `${q.data.progress || 0}/${q.data.target || 0}`;
        }
        const status = q.data.claimed ? CLAIMED_LABEL : (q.data.completed ? READY_ICON : '');
        parts.push(`${QUEST_BULLET} ${nice}: ${progressText} ${status}`);
    }

    const msg = `${header}\n${parts.join('\n')}`;
    await pm(gameServerId, name, msg);
}

await main();
