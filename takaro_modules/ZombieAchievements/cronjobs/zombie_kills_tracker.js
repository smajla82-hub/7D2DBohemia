import { data, takaro } from '@takaro/helpers';

const VARIABLE_KEY = 'lastAchievementCheck';
const ACHIEVEMENTS = [
    { kills: 100, name: 'Zombie Slayer', reward: 50 },
    { kills: 1000, name: 'Zombie Hunter', reward: 500 },
    { kills: 5000, name: 'Master Cleaner', reward: 2500 },
    { kills: 10000, name: 'Apocalypse Survivor', reward: 5000 }
];

async function main() {
    const { gameServerId, module: mod } = data;

    const lastRunRes = (await takaro.variable.variableControllerSearch({
        filters: {
            key: [VARIABLE_KEY],
            gameServerId: [gameServerId],
            moduleId: [mod.moduleId],
        },
    })).data.data;

    const lastRun = lastRunRes.length ? new Date(JSON.parse(lastRunRes[0].value)) : new Date(Date.now() - 5 * 60 * 1000);

    // Fetch all kill events since last check
    const killEvents = (await takaro.event.eventControllerSearch({
        filters: { eventName: ['entity-killed'], gameserverId: [gameServerId] },
        greaterThan: { createdAt: lastRun.toISOString() },
        limit: 1000,
    })).data.data;

    // Group events by player
    const playerKills = {};
    for (const killEvent of killEvents) {
        if (!playerKills[killEvent.playerId]) {
            playerKills[killEvent.playerId] = 0;
        }
        playerKills[killEvent.playerId] = playerKills[killEvent.playerId] + 1;
    }

    // Process each player's kills
    const results = await Promise.allSettled(Object.entries(playerKills).map(async ([playerId, newKills]) => {
        // Get or create lifetime kill counter
        const killCountVar = await takaro.variable.variableControllerSearch({
            filters: {
                key: ['lifetime_zombie_kills'],
                gameServerId: [gameServerId],
                playerId: [playerId],
                moduleId: [mod.moduleId]
            }
        });

        // Ensure newKills is a number
        const newKillsNum = Number(newKills) || 0;
        let totalKills = newKillsNum;

        if (killCountVar.data.data.length > 0) {
            const currentKills = parseInt(killCountVar.data.data[0].value) || 0;
            totalKills = currentKills + newKillsNum;
            await takaro.variable.variableControllerUpdate(killCountVar.data.data[0].id, {
                value: totalKills.toString()
            });
        } else {
            await takaro.variable.variableControllerCreate({
                key: 'lifetime_zombie_kills',
                value: totalKills.toString(),
                gameServerId,
                moduleId: mod.moduleId,
                playerId: playerId
            });
        }

        // Check achievements
        for (const achievement of ACHIEVEMENTS) {
            const prevKills = totalKills - newKillsNum;

            // Check if player just crossed this milestone
            if (prevKills < achievement.kills && totalKills >= achievement.kills) {
                const achievementKey = 'achievement_' + achievement.kills;

                // Check if already granted
                const achievementVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [achievementKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                if (achievementVar.data.data.length === 0) {
                    // Grant achievement
                    await takaro.variable.variableControllerCreate({
                        key: achievementKey,
                        value: 'true',
                        gameServerId,
                        moduleId: mod.moduleId,
                        playerId: playerId
                    });

                    // Award currency
                    await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(
                        gameServerId,
                        playerId,
                        { currency: achievement.reward }
                    );

                    // Send notification
                    const pog = (await takaro.playerOnGameserver.playerOnGameServerControllerGetOne(gameServerId, playerId)).data.data;
                    const player = await takaro.player.playerControllerGetOne(pog.playerId);
                    const playerName = player.data.data.name;

                    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
                        message: '🏆 ' + playerName + ' Finished: ' + achievement.name + ' (' + achievement.kills + ' kills)!   Reward: ' + achievement.reward + ' Beers!'
                    });
                }
            }
        }

        return true;
    }));

    // Update last run time
    if (lastRunRes.length) {
        await takaro.variable.variableControllerUpdate(lastRunRes[0].id, {
            value: JSON.stringify(new Date()),
        });
    } else {
        await takaro.variable.variableControllerCreate({
            key: VARIABLE_KEY,
            value: JSON.stringify(new Date()),
            moduleId: mod.moduleId,
            gameServerId,
        });
    }
}

await main();
