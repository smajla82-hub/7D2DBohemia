// =====================================
// FILE 6: dailyclaim.js 
// =====================================
import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const today = new Date().toISOString().split('T')[0];
    const playerId = pog.playerId;

    try {
        const questTypes = ['timespent', 'vote', 'zombiekills', 'levelgain', 'shopquest'];
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

                if (questVar?.data?.data?.length > 0) {
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

        if (completedQuests.length === 0) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${player.name}" "No completed quests ready to claim! Complete quests and try again."`
            });
            return;
        }

        let claimedCount = 0;
        let totalCurrency = 0;

        for (const quest of completedQuests) {
            quest.data.claimed = true;
            await takaro.variable.variableControllerUpdate(quest.variableId, {
                value: JSON.stringify(quest.data)
            });

            let currencyAmount = 25;
            if (quest.type === 'vote') {
                currencyAmount = 50;
            }

            if (currencyAmount > 0) {
                await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(
                    gameServerId,
                    playerId,
                    { currency: currencyAmount }
                );

                totalCurrency += currencyAmount;
                claimedCount++;
            }
        }

        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "Quest rewards claimed! ${claimedCount} quests completed - ${totalCurrency} currency received!"`
        });

    } catch (error) {
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "Error claiming rewards. Please try again or contact an admin."`
        });
    }
}

await main();
