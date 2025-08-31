import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;

    const today = new Date().toDateString();
    const playerId = pog.playerId;

    try {
        // Force initialize all daily quests for today - using working structure from old version
        const questTypes = [
            { type: 'timespent', target: 1200000 }, // 20 minutes = 1200000 ms
            { type: 'vote', target: 1 },
            { type: 'zombiekills', target: 5 }, // 5 kills
            { type: 'levelgain', target: 1 }, // 1 level for testing
            { type: 'traderquests', target: 1 } // 1 quest for testing
        ];

        let successCount = 0;
        let errorCount = 0;

        for (const quest of questTypes) {
            try {
                await takaro.variable.variableControllerCreate({
                    key: `dailyquest_${playerId}_${today}_${quest.type}`,
                    value: JSON.stringify({
                        type: quest.type,
                        progress: 0,
                        target: quest.target,
                        completed: false,
                        claimed: false,
                        startTime: Date.now()
                    }),
                    gameServerId: gameServerId,
                    playerId: playerId,
                    moduleId: mod.moduleId
                });
                successCount++;
            } catch (createError) {
                errorCount++;
            }
        }

        // Create fresh session with ZERO time - FORCE RESET
        try {
            const sessionKey = `session_${playerId}_${today}`;
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
            // If session exists, force update it to zero
            try {
                const existingSession = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [sessionKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                if (existingSession && existingSession.data && existingSession.data.data && existingSession.data.data.length > 0) {
                    await takaro.variable.variableControllerUpdate(existingSession.data.data[0].id, {
                        value: JSON.stringify({
                            startTime: Date.now(),
                            totalTime: 0,
                            lastUpdate: Date.now()
                        })
                    });
                }
            } catch (updateError) {
                // Continue
            }
        }

        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: `Quest initialization complete! Created: ${successCount}, Errors: ${errorCount} - Session time reset to 0.`
        });

    } catch (error) {
        throw new TakaroUserError('Initialization error. Please try again.');
    }
}

await main();