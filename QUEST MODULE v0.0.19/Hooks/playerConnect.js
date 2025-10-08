// =====================================
// FILE 1: playerConnect.js (Hook)
// =====================================
import { takaro, data } from '@takaro/helpers';

async function main() {
    const { player, gameServerId, module: mod } = data;
    const today = new Date().toISOString().split('T')[0];
    const playerId = player.id;

    try {
        const existingQuest = await takaro.variable.variableControllerSearch({
            filters: {
                key: [`dailyquest_${playerId}_${today}_vote`],
                gameServerId: [gameServerId],
                playerId: [playerId],
                moduleId: [mod.moduleId]
            }
        });

        if (!existingQuest?.data?.data?.length) {
            const questTypes = [
                { type: 'timespent', target: 3600000 },
                { type: 'vote', target: 1 },
                { type: 'zombiekills', target: 200 },
                { type: 'levelgain', target: 5 },
                { type: 'shopquest', target: 1 }
            ];

            let createCount = 0;

            for (const questConfig of questTypes) {
                const questKey = `dailyquest_${playerId}_${today}_${questConfig.type}`;

                const questData = {
                    type: questConfig.type,
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

            if (createCount > 0) {
                await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                    command: `pm "${player.name}" "Welcome back! Fresh daily quests are ready! Type /daily to see your challenges for today!"`
                });
            }
        } else {
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
                    const sessionData = JSON.parse(existingSession.data.data[0].value);
                    sessionData.lastUpdate = Date.now();

                    await takaro.variable.variableControllerUpdate(existingSession.data.data[0].id, {
                        value: JSON.stringify(sessionData)
                    });
                }
            } catch (sessionError) { }
        }

    } catch (error) {
        // Silent fail
    }
}


await main();
