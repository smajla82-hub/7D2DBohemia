// =====================================
// FILE 4: autoClaimRewards.js (Cron Job - runs every 15 seconds)
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
    const pragueOffset = 1; // CET is UTC+1
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pragueTime = new Date(utc + (3600000 * pragueOffset));
    return pragueTime.toISOString().split('T')[0];
}

async function main() {
    const { gameServerId, module: mod } = data;
    const today = getPragueDate();

    try {
        // Get all players with autoclaim queues
        const allQueues = await takaro.variable.variableControllerSearch({
            filters: {
                gameServerId: [gameServerId],
                moduleId: [mod.moduleId]
            },
            limit: 1000
        });

        for (const queueVar of allQueues.data.data) {
            if (!queueVar.key.startsWith('autoclaim_queue_')) continue;

            const playerId = queueVar.playerId;
            if (!playerId) continue;

            let queue = [];
            try {
                queue = JSON.parse(queueVar.value);
                if (!Array.isArray(queue) || queue.length === 0) continue;
            } catch (e) {
                continue;
            }

            const playerName = await getPlayerName(playerId);
            let claimedCount = 0;
            let totalCurrency = 0;
            const processedTypes = [];

            for (const questType of queue) {
                const questKey = `dailyquest_${playerId}_${today}_${questType}`;
                
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
                        let questData;
                        try {
                            questData = JSON.parse(questVar.data.data[0].value);
                        } catch (parseErr) {
                            continue;
                        }

                        if (questData.completed && !questData.claimed) {
                            questData.claimed = true;
                            await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
                                value: JSON.stringify(questData)
                            });

                            let currencyAmount = 25;
                            if (questType === 'vote') {
                                currencyAmount = 50;
                            }

                            if (currencyAmount > 0) {
                                try {
                                    await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(
                                        gameServerId,
                                        playerId,
                                        { currency: currencyAmount }
                                    );
                                    totalCurrency += currencyAmount;
                                    claimedCount++;
                                    processedTypes.push(questType);
                                } catch (currencyErr) {
                                    // Failed to add currency, don't mark as claimed
                                    questData.claimed = false;
                                    await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
                                        value: JSON.stringify(questData)
                                    });
                                }
                            }
                        } else {
                            // Already claimed or not completed, remove from queue
                            processedTypes.push(questType);
                        }
                    } else {
                        // Quest not found, remove from queue
                        processedTypes.push(questType);
                    }
                } catch (questErr) {
                    // Error processing this quest, skip it
                }
            }

            // Update queue by removing processed items
            const remainingQueue = queue.filter(t => !processedTypes.includes(t));
            
            if (remainingQueue.length > 0) {
                await takaro.variable.variableControllerUpdate(queueVar.id, {
                    value: JSON.stringify(remainingQueue)
                });
            } else {
                // Queue is empty, delete it
                await takaro.variable.variableControllerDelete(queueVar.id);
            }

            // Send reward message if any quests were claimed
            if (claimedCount > 0) {
                const questWord = claimedCount === 1 ? 'quest' : 'quests';
                await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                    command: `pm "${playerName}" "✪ Quest Rewards ✪ ${claimedCount} ${questWord} completed - ${totalCurrency} currency received!"`
                });
            }
        }

    } catch (error) {
        // Silent fail - cron will retry
    }
}

await main();
