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

function getPragueDate() {
    const now = new Date();
    const pragueOffset = 1; // CET is UTC+1, CEST is UTC+2 but we use +1 for consistency
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pragueTime = new Date(utc + (3600000 * pragueOffset));
    return pragueTime.toISOString().split('T')[0];
}

function getRotatedQuestTypes(dateStr, serverId) {
    // Deterministic rotation: vote always included, others rotate daily per server
    const allOptional = ['timespent', 'zombiekills', 'levelgain', 'shopquest'];
    const seed = parseInt(dateStr.replace(/-/g, '')) + parseInt(serverId);
    const rng = (seed * 9301 + 49297) % 233280 / 233280;
    const count = 2; // Select 2 additional quests besides vote
    const shuffled = allOptional.sort(() => (rng * allOptional.length) % 1 - 0.5);
    const selected = shuffled.slice(0, count);
    return ['vote', ...selected]; // vote always included
}

async function main() {
    const { gameServerId, module: mod } = data;
    const today = getPragueDate();
    const activeTypes = getRotatedQuestTypes(today, gameServerId);
    
    // Store active types globally for other scripts
    const activeTypesKey = `dailyquests_active_types_${today}`;
    try {
        await takaro.variable.variableControllerCreate({
            key: activeTypesKey,
            value: JSON.stringify(activeTypes),
            gameServerId: gameServerId,
            moduleId: mod.moduleId
        });
    } catch (e) {
        // May already exist, update it
        const existing = await takaro.variable.variableControllerSearch({
            filters: {
                key: [activeTypesKey],
                gameServerId: [gameServerId],
                moduleId: [mod.moduleId]
            }
        });
        if (existing?.data?.data?.length > 0) {
            await takaro.variable.variableControllerUpdate(existing.data.data[0].id, {
                value: JSON.stringify(activeTypes)
            });
        }
    }

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

    // Retention=0: Delete all old quest variables before creating new ones
    for (const playerObj of playerList) {
        const playerId = playerObj.playerId;
        
        // Delete all old dailyquest_* keys for this player
        const allQuestKeys = await takaro.variable.variableControllerSearch({
            filters: {
                gameServerId: [gameServerId],
                playerId: [playerId],
                moduleId: [mod.moduleId]
            },
            limit: 1000
        });
        
        for (const varItem of allQuestKeys.data.data) {
            if (varItem.key.startsWith('dailyquest_')) {
                try {
                    await takaro.variable.variableControllerDelete(varItem.id);
                } catch (e) { }
            }
        }
    }

    for (const playerObj of playerList) {
        const playerId = playerObj.playerId;
        const playerName = await getPlayerName(playerId);

        const questTypeConfigs = {
            'timespent': { target: 3600000 },
            'vote': { target: 1 },
            'zombiekills': { target: 200 },
            'levelgain': { target: 5 },
            'shopquest': { target: 1 }
        };

        for (const type of activeTypes) {
            const questConfig = questTypeConfigs[type];
            if (!questConfig) continue;
            
            const questKey = `dailyquest_${playerId}_${today}_${type}`;
            try {
                const questData = {
                    type: type,
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
        // Only create session if timespent is in active types
        if (activeTypes.includes('timespent')) {
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