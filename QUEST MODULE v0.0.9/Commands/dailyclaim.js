import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;

    const today = new Date().toDateString();
    const playerId = pog.playerId;

    try {
        // Get all quests to find completed ones
        const questTypes = ['timespent', 'vote', 'zombiekills', 'levelgain', 'traderquests'];
        const completedQuests = [];

        for (const type of questTypes) {
            try {
                const questVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [`dailyquest_${playerId}_${today}_${type}`],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                if (questVar && questVar.data && questVar.data.data && questVar.data.data.length > 0) {
                    const questData = JSON.parse(questVar.data.data[0].value);
                    if (questData.completed && !questData.claimed) {
                        completedQuests.push({
                            type: type,
                            data: questData,
                            variableId: questVar.data.data[0].id
                        });
                    }
                }
            } catch (searchError) {
                // Skip
            }
        }

        // If no completed quests
        if (completedQuests.length === 0) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm ${player.name} "No completed quests ready to claim!"`
            });
            return;
        }

        // Auto-claim all completed quests
        let claimedCount = 0;
        let totalCurrency = 0;

        for (const quest of completedQuests) {
            // Mark as claimed
            quest.data.claimed = true;
            await takaro.variable.variableControllerUpdate(quest.variableId, {
                value: JSON.stringify(quest.data)
            });

            // Give rewards using game currency (like Economy module)
            const rewards = {
                timespent: 500,
                vote: 1000,
                zombiekills: 750,
                levelgain: 300,
                traderquests: 600
            };

            const currencyAmount = rewards[quest.type] || 0;
            if (currencyAmount > 0) {
                // Use the same method as Economy module
                await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, playerId, {
                    currency: currencyAmount,
                });

                totalCurrency += currencyAmount;
                claimedCount++;
            }
        }

        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm ${player.name} "Quest rewards claimed! ${claimedCount} quests completed - ${totalCurrency} currency received!"`
        });

    } catch (error) {
        throw new TakaroUserError('Error claiming rewards.');
    }
}

await main();