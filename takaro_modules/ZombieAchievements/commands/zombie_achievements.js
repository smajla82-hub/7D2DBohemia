import { takaro, data } from '@takaro/helpers';

const PM_CHANNEL = 'Brewer';

function quoteIfNeeded(text) {
    return /\s/.test(text) ? `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : String(text);
}

async function main() {
    const { gameServerId, module: mod } = data;

    const ACHIEVEMENTS = [
        { kills: 100, name: 'Zombie Slayer' },
        { kills: 1000, name: 'Zombie Hunter' },
        { kills: 5000, name: 'Master Cleaner' },
        { kills: 10000, name: 'Apocalypse Survivor' }
    ];

    // Get player's kill count
    const killCountVar = await takaro.variable.variableControllerSearch({
        filters: {
            key: ['lifetime_zombie_kills'],
            gameServerId: [gameServerId],
            playerId: [data.player.id],
            moduleId: [mod.moduleId]
        }
    });

    const currentKills = killCountVar.data.data.length > 0
        ? parseInt(killCountVar.data.data[0].value)
        : 0;

    let message = '== YOUR ACHIEVEMENTS ==          ';
    message += '            .                     **Total Zombie Kills: ' + currentKills + '**                      .';

    for (const achievement of ACHIEVEMENTS) {
        const achievementKey = 'achievement_' + achievement.kills;

        const achievementVar = await takaro.variable.variableControllerSearch({
            filters: {
                key: [achievementKey],
                gameServerId: [gameServerId],
                playerId: [data.player.id],
                moduleId: [mod.moduleId]
            }
        });

        const isUnlocked = achievementVar.data.data.length > 0;

        if (isUnlocked) {
            message += '✅ ' + achievement.name + ' (' + achievement.kills + ' kills) - COMPLETED\n';
        } else {
            const progress = currentKills >= achievement.kills ? 100 : Math.floor((currentKills / achievement.kills) * 100);
            message += '⬜ ' + achievement.name + ' - ' + progress + '%\n';
        }
    }

    const playerName = data.player.name;

    try {
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm2 ${PM_CHANNEL} ${playerName} ${quoteIfNeeded(message)}`
        });
    } catch { }
}

await main();
