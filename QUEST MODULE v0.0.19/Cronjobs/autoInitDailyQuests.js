// =====================================
// FILE 2: autoInitDailyQuests.js (Cron Job - Daily at midnight)
// =====================================
import { takaro, data } from '@takaro/helpers';

async function getPlayerName(playerId) {
    try {
        const playerRes = await takaro.player.playerControllerGetOne(playerId);
        if (playerRes?.data?.data?.name) {
            return playerRes.data.data.name;
        }
    } catch (e) { }
    return `Player_${playerId}`;
}

async function main() {
    const { gameServerId, module: mod } = data;
    const today = new Date().toISOString().split('T')[0];

    let playerList = [];
    try {
        const playersRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
            filters: { gameServerId: [gameServerId] },
            limit: 1000
        });
        playerList = playersRes.data.data;
    } catch (e) {
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: 'Failed to load player list for daily quest initialization.'
        });
        return;
    }

    let onlinePlayerIds = new Set();
    try {
        const onlinePlayers = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
            filters: { gameServerId: [gameServerId], online: [true] },
            limit: 1000
        });
        for (const p of onlinePlayers.data.data) {
            onlinePlayerIds.add(p.playerId);
        }
    } catch (e) { }

    for (const playerObj of playerList) {
        const playerId = playerObj.playerId;
        const playerName = await getPlayerName(playerId);

        const questTypes = [
            { type: 'timespent', target: 3600000 },
            { type: 'vote', target: 1 },
            { type: 'zombiekills', target: 200 },
            { type: 'levelgain', target: 5 },
            { type: 'shopquest', target: 1 }
        ];

        for (const questConfig of questTypes) {
            const questKey = `dailyquest_${playerId}_${today}_${questConfig.type}`;
            try {
                const existingQuest = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [questKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });
                if (existingQuest?.data?.data?.length > 0) {
                    await takaro.variable.variableControllerDelete(existingQuest.data.data[0].id);
                }
            } catch (e) { }
            try {
                const questData = {
                    type: questConfig.type,
                    target: questConfig.target,
                    progress: 0,
                    completed: false,
                    claimed: false,
                    createdAt: new Date().toISOString()
                };
                await takaro.variable.variableControllerCreate({
                    key: questKey,
                    value: JSON.stringify(questData),
                    gameServerId: gameServerId,
                    playerId: playerId,
                    moduleId: mod.moduleId
                });
            } catch (e) { }
        }

        const sessionKey = `session_${playerId}_${today}`;
        try {
            await takaro.variable.variableControllerCreate({
                key: sessionKey,
                value: JSON.stringify({
                    startTime: Date.now(),
                    totalTime: 0,
                    lastUpdate: Date.now()
                }),
                gameServerId: gameServerId,
                playerId: playerId,
                moduleId: mod.moduleId
            });
        } catch (sessionError) {
            try {
                const existingSession = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [sessionKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });
                if (existingSession?.data?.data?.length > 0) {
                    const sessionData = JSON.parse(existingSession.data.data[0].value);
                    sessionData.lastUpdate = Date.now();
                    await takaro.variable.variableControllerUpdate(existingSession.data.data[0].id, {
                        value: JSON.stringify(sessionData)
                    });
                }
            } catch (e) { }
        }

        if (onlinePlayerIds.has(playerId)) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${playerName}" "Daily quests have been refreshed! Type /daily to see your new challenges!"`
            });
        }
    }

    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: 'Daily quests have been reset for all players! Type /daily to see your new challenges.'
    });
}

await main();