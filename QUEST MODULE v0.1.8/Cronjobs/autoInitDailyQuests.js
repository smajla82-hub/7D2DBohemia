// =====================================
// FILE 2: autoInitDailyQuests.js (Cron Job - Daily at midnight)
// =====================================
import { takaro, data } from '@takaro/helpers';

async function getPlayerName(playerId) {
    // Try to get the player name from Takaro API
    try {
        const playerRes = await takaro.player.playerControllerGetOne(playerId);
        if (playerRes?.data?.data?.name) {
            return playerRes.data.data.name;
        }
    } catch (e) {
        // Fallback
    }
    return `Player_${playerId}`;
}

async function main() {
    const { gameServerId, module: mod } = data;
    const today = new Date().toDateString();

    // Fetch all players from the Takaro API for this server
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

    // Get online player IDs (for PMs after quest reset)
    let onlinePlayerIds = new Set();
    try {
        const onlinePlayers = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
            filters: { gameServerId: [gameServerId], online: [true] },
            limit: 1000
        });
        for (const p of onlinePlayers.data.data) {
            onlinePlayerIds.add(p.playerId);
        }
    } catch (e) {
        // Ignore error, fallback: no online PMs
    }

    for (const playerObj of playerList) {
        const playerId = playerObj.playerId;
        const playerName = await getPlayerName(playerId);

        // For each quest type, create or reset
        const questTypes = [
            { type: 'timespent', target: 3600000 },
            { type: 'vote', target: 1 },
            { type: 'zombiekills', target: 200 },
            { type: 'levelgain', target: 5 },
            { type: 'shopquest', target: 1 }
        ];

        for (const questConfig of questTypes) {
            const questKey = `dailyquest_${playerId}_${today}_${questConfig.type}`;
            // Delete existing quest for today if present
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
            // Create new quest
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

        // Create/update session variable for today
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
            // Session exists, update it
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

        // PM online players only (after quest reset)
        if (onlinePlayerIds.has(playerId)) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${playerName}" "Daily quests have been refreshed! Type /daily to see your new challenges!"`
            });
        }
    }

    // Optionally, send a global message
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: 'Daily quests have been reset for all players! Type /daily to see your new challenges.'
    });
}

await main();