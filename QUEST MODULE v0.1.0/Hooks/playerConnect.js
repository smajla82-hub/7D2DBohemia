// =====================================
// FILE 1: playerConnect.js (Hook)
// =====================================
import { takaro, data } from '@takaro/helpers';

function getPragueDate() {
    const now = new Date();
    const pragueOffset = 1; // CET is UTC+1
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pragueTime = new Date(utc + (3600000 * pragueOffset));
    return pragueTime.toISOString().split('T')[0];
}

async function main() {
    const { player, gameServerId, module: mod } = data;
    const today = getPragueDate();
    const playerId = player.id;

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

        // Check if today's quests exist (check for vote since it's always active)
        const existingQuest = await takaro.variable.variableControllerSearch({
            filters: {
                key: [`dailyquest_${playerId}_${today}_vote`],
                gameServerId: [gameServerId],
                playerId: [playerId],
                moduleId: [mod.moduleId]
            }
        });

        if (!existingQuest?.data?.data?.length) {
            const questTypeConfigs = {
                'timespent': { target: 3600000 },
                'vote': { target: 1 },
                'zombiekills': { target: 200 },
                'levelgain': { target: 5 },
                'shopquest': { target: 1 }
            };

            let createCount = 0;

            for (const type of activeTypes) {
                const questConfig = questTypeConfigs[type];
                if (!questConfig) continue;
                
                const questKey = `dailyquest_${playerId}_${today}_${type}`;

                const questData = {
                    type: type,
                    target: questConfig.target,
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
                } catch (createError) { }
            }

            const sessionKey = `session_${playerId}_${today}`;
            // Only create session if timespent is active
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
                    } catch (updateError) { }
                }
            }

            if (createCount > 0) {
                await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                    command: `pm "${player.name}" "Welcome back! Fresh daily quests are ready! Type /daily to see your challenges for today!"`
                });
            }
        } else {
            const sessionKey = `session_${playerId}_${today}`;
            // Only update session if timespent is active
            if (activeTypes.includes('timespent')) {
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
                } catch (sessionError) { }
            }
        }

    } catch (error) {
        // Silent fail
    }
}


await main();
