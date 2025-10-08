// =====================================
// FILE 7: initquests.js
// =====================================
import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const today = new Date().toISOString().split('T')[0];
    const playerId = pog.playerId;

    try {
        const questTypes = [
            { type: 'timespent', target: 3600000 }, // 1 hour
            { type: 'vote', target: 1 },
            { type: 'zombiekills', target: 200 },
            { type: 'levelgain', target: 5 },
            { type: 'shopquest', target: 1 }
        ];

        let createCount = 0;

        for (const questConfig of questTypes) {
            const questKey = `dailyquest_${playerId}_${today}_${questConfig.type}`;

            const existingQuest = await takaro.variable.variableControllerSearch({
                filters: {
                    key: [questKey],
                    gameServerId: [gameServerId],
                    playerId: [playerId],
                    moduleId: [mod.moduleId]
                }
            });

            if (!existingQuest?.data?.data?.length) {
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

                createCount++;
            }
        }

        // Create session tracking
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
        }

        if (createCount > 0) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${player.name}" "Daily quests initialized! ${createCount} new quests created. Type /daily to see challenges!"`
            });
        } else {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${player.name}" "Daily quests already exist for today. Type /daily to see your progress!"`
            });
        }

    } catch (error) {
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "Quest system error. Please contact an admin."`
        });
    }
}

await main();
