import { takaro, data } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;

    const today = new Date().toDateString();
    const playerId = pog.playerId;

    try {
        // Get quest targets from config (cast userConfig to access properties)
        const config = mod.userConfig as any;
        const questTypes = [
            { type: 'timespent', target: (config.timespent || 20) * 60000 }, // Convert minutes to milliseconds
            { type: 'vote', target: 1 }, // Always 1 vote
            { type: 'zombiekills', target: config.zombiekills || 5 },
            { type: 'levelgain', target: 5 }, // Always 5 levels
            { type: 'traderquests', target: 10 } // Always 10 quests
        ];

        let createCount = 0;
        let skipCount = 0;

        for (const quest of questTypes) {
            try {
                // Check if this quest already exists
                const existing = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [`dailyquest_${playerId}_${today}_${quest.type}`],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                // Only create if doesn't exist
                if (!existing || !existing.data || !existing.data.data || existing.data.data.length === 0) {
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
                    createCount++;
                } else {
                    skipCount++;
                }
            } catch (createError) {
                skipCount++;
            }
        }

        // Create/update session tracking
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
            // Session might already exist, update it
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
                    const sessionData = JSON.parse(existingSession.data.data[0].value);
                    sessionData.startTime = Date.now();
                    sessionData.lastUpdate = Date.now();

                    await takaro.variable.variableControllerUpdate(existingSession.data.data[0].id, {
                        value: JSON.stringify(sessionData)
                    });
                }
            } catch (updateError) {
                // Ignore
            }
        }

        // Send proper private message
        if (createCount > 0) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm ${player.name} "Welcome! Daily quests initialized. Type /daily to see challenges!"`
            });
        }

    } catch (error) {
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm ${player.name} "Quest system error during login. Use /initquests if needed."`
        });
    }
}

await main();