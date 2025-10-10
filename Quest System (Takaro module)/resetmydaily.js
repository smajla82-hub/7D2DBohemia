// =====================================
// FILE: resetmydaily.js (Admin/Testing Command)
// =====================================
import { takaro, data, TakaroUserError } from '@takaro/helpers';
import { getQuestConfig, getTargetFor, getPragueDate } from './questConfig.js';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const config = getQuestConfig(mod);
    const today = getPragueDate();
    const playerId = pog.playerId;

    try {
        // Get today's active quest types
        const activeTypesKey = `dailyquests_active_types_${today}`;
        let activeTypes = ['vote', 'timespent', 'zombiekills']; // Default fallback
        
        try {
            const activeTypesVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: [activeTypesKey],
                    gameServerId: [gameServerId],
                    moduleId: [mod.moduleId]
                }
            });
            if (activeTypesVar?.data?.data?.length > 0) {
                activeTypes = JSON.parse(activeTypesVar.data.data[0].value);
            }
        } catch (e) { }

        // Delete existing quests for today
        let deletedCount = 0;
        for (const type of activeTypes) {
            const questKey = `dailyquest_${playerId}_${today}_${type}`;
            try {
                const questVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [questKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });
                
                if (questVar?.data?.data?.length > 0) {
                    await takaro.variable.variableControllerDelete(questVar.data.data[0].id);
                    deletedCount++;
                }
            } catch (e) { }
        }

        // Delete autoclaim queue
        try {
            const queueKey = `autoclaim_queue_${playerId}`;
            const queueVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: [queueKey],
                    gameServerId: [gameServerId],
                    playerId: [playerId],
                    moduleId: [mod.moduleId]
                }
            });
            
            if (queueVar?.data?.data?.length > 0) {
                await takaro.variable.variableControllerDelete(queueVar.data.data[0].id);
            }
        } catch (e) { }

        // Recreate quests with configured targets
        let createCount = 0;
        for (const type of activeTypes) {
            const target = getTargetFor(config, type);
            const questKey = `dailyquest_${playerId}_${today}_${type}`;

            const questData = {
                type: type,
                target: target,
                progress: 0,
                completed: false,
                claimed: false,
                createdAt: new Date().toISOString()
            };

            try {
                await takaro.variable.variableControllerCreate({
                    key: questKey,
                    value: JSON.stringify(questData),
                    gameServerId: gameServerId,
                    playerId: playerId,
                    moduleId: mod.moduleId
                });
                createCount++;
            } catch (e) { }
        }

        // Reset session if timespent is active
        if (activeTypes.includes('timespent') && config.enable_time_tracking) {
            const sessionKey = `session_${playerId}_${today}`;
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
                    await takaro.variable.variableControllerUpdate(existingSession.data.data[0].id, {
                        value: JSON.stringify({
                            startTime: Date.now(),
                            totalTime: 0,
                            lastUpdate: Date.now()
                        })
                    });
                } else {
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
                }
            } catch (e) { }
        }

        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "Your daily quests have been reset! Deleted ${deletedCount}, created ${createCount} fresh quests. Type /daily to see them."`
        });

    } catch (error) {
        throw new TakaroUserError('Error resetting daily quests: ' + (error.message || error));
    }
}

await main();
