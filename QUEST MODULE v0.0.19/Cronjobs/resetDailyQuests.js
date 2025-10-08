// =====================================
// FILE 4: resetDailyQuest.js 
// =====================================
import { takaro, data } from '@takaro/helpers';

async function main() {
    const { gameServerId, module: mod } = data;

    try {
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: 'Daily quests have been reset! Use /initquests to get fresh quests!'
        });

        const allModuleVars = await takaro.variable.variableControllerSearch({
            filters: {
                gameServerId: [gameServerId],
                moduleId: [mod.moduleId]
            },
            limit: 1000
        });

        let deletedCount = 0;
        const today = new Date().toISOString().split('T')[0];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 2);

        if (allModuleVars?.data?.data) {
            for (const variable of allModuleVars.data.data) {
                try {
                    const key = variable.key;

                    if (key.includes('dailyquest_') || key.includes('session_')) {
                        let shouldDelete = false;

                        if (!key.includes(today)) {
                            shouldDelete = true;
                        }

                        if (shouldDelete) {
                            await takaro.variable.variableControllerDelete(variable.id);
                            deletedCount++;
                        }
                    }
                } catch (deleteError) {
                    continue;
                }
            }
        }

        try {
            const trackingVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: ['lastQuestUpdate'],
                    gameServerId: [gameServerId],
                    moduleId: [mod.moduleId]
                }
            });

            if (trackingVar?.data?.data?.length > 0) {
                await takaro.variable.variableControllerDelete(trackingVar.data.data[0].id);
                deletedCount++;
            }
        } catch (trackingError) { }

        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: `Reset complete! Deleted ${deletedCount} old variables. All players should use /initquests for fresh quests.`
        });

    } catch (error) {
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: 'Daily reset encountered issues. Some cleanup may be incomplete.'
        });
    }
}

await main();
