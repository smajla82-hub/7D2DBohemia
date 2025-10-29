// =====================================
// FILE: qdebug.js (v0.3.0)
// - Inspect today's vote/levelgain variables for the invoking player across modules.
// - Usage: /qdebug [vote|levelgain]  (default: both)
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

    const arg = (data?.arguments?.raw || '').trim().toLowerCase();
    const types = arg === 'vote' || arg === 'levelgain' ? [arg] : ['vote', 'levelgain'];

    const lines = [];
    for (const type of types) {
        const key = `dailyquest_${playerId}_${today}_${type}`;
        // own
        const own = await takaro.variable.variableControllerSearch({
            filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId], moduleId: [mod.moduleId] }
        });
        if (own.data.data.length) {
            const v = own.data.data[0];
            let p; try { p = JSON.parse(v.value); } catch { p = {}; }
            lines.push(`[own:${type}] progress=${p.progress || 0}/${p.target || '?'} completed=${!!p.completed} claimed=${!!p.claimed}`);
        } else {
            lines.push(`[own:${type}] not found`);
        }
        // any
        const any = await takaro.variable.variableControllerSearch({
            filters: { key: [key], gameServerId: [gameServerId], playerId: [playerId] }
        });
        if (any.data.data.length) {
            const v = any.data.data[0];
            let p; try { p = JSON.parse(v.value); } catch { p = {}; }
            lines.push(`[any:${type}] moduleId=${v.moduleId || 'null'} progress=${p.progress || 0}/${p.target || '?'} completed=${!!p.completed} claimed=${!!p.claimed}`);
        } else {
            lines.push(`[any:${type}] not found`);
        }
    }

    await pm(gameServerId, name, lines.join(' | '));
}

await main();
