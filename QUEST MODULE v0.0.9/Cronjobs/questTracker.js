import { takaro, data } from '@takaro/helpers';

async function main() {
    const { gameServerId, module: mod } = data;

    const VARIABLE_KEY = 'lastQuestUpdate';
    const today = new Date().toDateString();

    try {
        // Get last run time
        const lastRunRes = await takaro.variable.variableControllerSearch({
            filters: {
                key: [VARIABLE_KEY],
                gameServerId: [gameServerId],
                moduleId: [mod.moduleId],
            },
        });

        // If first time, get events from last 5 minutes
        const lastRun = lastRunRes.data.data.length ?
            new Date(JSON.parse(lastRunRes.data.data[0].value)) :
            new Date(Date.now() - 5 * 60 * 1000);

        // Fetch kill events since last run
        const killEvents = await takaro.event.eventControllerSearch({
            filters: {
                eventName: ['entity-killed'],
                gameserverId: [gameServerId]
            },
            greaterThan: { createdAt: lastRun.toISOString() },
            limit: 1000,
        });

        // Group kills by player
        const playerKills = {};
        for (const killEvent of killEvents.data.data) {
            if (!playerKills[killEvent.playerId]) {
                playerKills[killEvent.playerId] = 0;
            }
            playerKills[killEvent.playerId]++;
        }

        // Update zombie kill quests for each player
        for (const [playerId, killCountRaw] of Object.entries(playerKills)) {
            const killCount = Number(killCountRaw);
            if (killCount > 0) {
                try {
                    const questKey = `dailyquest_${playerId}_${today}_zombiekills`;

                    const questVar = await takaro.variable.variableControllerSearch({
                        filters: {
                            key: [questKey],
                            gameServerId: [gameServerId],
                            playerId: [playerId],
                            moduleId: [mod.moduleId]
                        }
                    });

                    if (questVar.data.data.length > 0) {
                        const questData = JSON.parse(questVar.data.data[0].value);

                        if (!questData.completed && !questData.claimed) {
                            questData.progress += killCount;

                            // Check if completed (use quest's own target)
                            if (questData.progress >= questData.target) {
                                questData.completed = true;

                                // Notify player if online
                                try {
                                    const playerInfo = await takaro.player.playerControllerGetOne(playerId);
                                    const playerName = playerInfo.data.data.name;
                                    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                                        command: `pm ${playerName} "ZOMBIE HUNTER quest completed! ${questData.progress}/${questData.target} kills. Use /dailyclaim for 750 currency!"`
                                    });
                                } catch (notifyError) {
                                    // Player might be offline
                                }
                            }

                            await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
                                value: JSON.stringify(questData)
                            });
                        }
                    }
                } catch (questError) {
                    // Skip this player if quest doesn't exist
                }
            }
        }

        // Update time spent quests for ALL online players (not just those who killed something)
        const onlinePlayers = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
            filters: {
                gameServerId: [gameServerId],
                online: [true]
            }
        });

        for (const playerOnServer of onlinePlayers.data.data) {
            try {
                const playerId = playerOnServer.playerId;
                const sessionKey = `session_${playerId}_${today}`;

                // Get or create session
                let sessionVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [sessionKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                let sessionData;
                let sessionId;

                if (sessionVar.data.data.length > 0) {
                    // Update existing session
                    sessionData = JSON.parse(sessionVar.data.data[0].value);
                    sessionId = sessionVar.data.data[0].id;

                    const currentTime = Date.now();
                    const timeSinceLastUpdate = Math.min(currentTime - sessionData.lastUpdate, 5 * 60 * 1000); // Max 5 minutes

                    sessionData.totalTime += timeSinceLastUpdate;
                    sessionData.lastUpdate = currentTime;

                    await takaro.variable.variableControllerUpdate(sessionId, {
                        value: JSON.stringify(sessionData)
                    });
                } else {
                    // Create new session for online player
                    sessionData = {
                        startTime: Date.now(),
                        totalTime: 0,
                        lastUpdate: Date.now()
                    };

                    const newSession = await takaro.variable.variableControllerCreate({
                        key: sessionKey,
                        value: JSON.stringify(sessionData),
                        gameServerId: gameServerId,
                        playerId: playerId,
                        moduleId: mod.moduleId
                    });
                }

                // Update time quest
                const questKey = `dailyquest_${playerId}_${today}_timespent`;

                const questVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [questKey],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                if (questVar.data.data.length > 0) {
                    const questData = JSON.parse(questVar.data.data[0].value);

                    if (!questData.completed && !questData.claimed) {
                        questData.progress = sessionData.totalTime;

                        // Check if completed (use quest's own target)
                        if (questData.progress >= questData.target) {
                            questData.completed = true;

                            // Notify player
                            try {
                                const playerInfo = await takaro.player.playerControllerGetOne(playerId);
                                const playerName = playerInfo.data.data.name;
                                const targetMinutes = Math.floor(questData.target / 60000);
                                await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                                    command: `pm ${playerName} "TIME SURVIVOR quest completed! Played for ${targetMinutes} minutes. Use /dailyclaim for 500 currency!"`
                                });
                            } catch (notifyError) {
                                // Ignore notification errors
                            }
                        }

                        await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
                            value: JSON.stringify(questData)
                        });
                    }
                }
            } catch (timeError) {
                // Skip this player if error
            }
        }

        // Update last run time
        if (lastRunRes.data.data.length) {
            await takaro.variable.variableControllerUpdate(lastRunRes.data.data[0].id, {
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

    } catch (error) {
        // Silently fail - will try again in 5 minutes
    }
}

await main();