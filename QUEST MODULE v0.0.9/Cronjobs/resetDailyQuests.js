import { takaro, data } from '@takaro/helpers';

async function main() {
    const { gameServerId, module: mod } = data;

    try {
        // Send server-wide notification
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: 'Daily quests have been reset! Use /initquests to get fresh quests with correct targets!'
        });

        // Get ALL variables for this module and gameserver (no wildcards)
        const allModuleVars = await takaro.variable.variableControllerSearch({
            filters: {
                gameServerId: [gameServerId],
                moduleId: [mod.moduleId]
            }
        });

        let deletedCount = 0;
        const today = new Date().toDateString();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 2); // Delete quests older than 2 days

        // Loop through all variables and delete old quest data
        if (allModuleVars && allModuleVars.data && allModuleVars.data.data) {
            for (const variable of allModuleVars.data.data) {
                try {
                    const key = variable.key;

                    // Check if it's a quest or session variable
                    if (key.includes('dailyquest_') || key.includes('session_')) {
                        // Extract date from key (format: dailyquest_playerID_datestring_questtype)
                        const keyParts = key.split('_');
                        if (keyParts.length >= 4) {
                            // Try to reconstruct the date from the key
                            const dateFromKey = keyParts[2] + ' ' + keyParts[3] + ' ' + keyParts[4] + ' ' + keyParts[5];
                            const variableDate = new Date(dateFromKey);

                            // If date is invalid or old, delete it
                            if (isNaN(variableDate.getTime()) || variableDate < cutoffDate) {
                                await takaro.variable.variableControllerDelete(variable.id);
                                deletedCount++;
                            }
                        }
                    }
                } catch (deleteError) {
                    // Continue with next variable
                }
            }
        }

        // Also clean up the lastQuestUpdate tracking variable for fresh start
        try {
            const trackingVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: ['lastQuestUpdate'],
                    gameServerId: [gameServerId],
                    moduleId: [mod.moduleId]
                }
            });

            if (trackingVar.data.data.length > 0) {
                await takaro.variable.variableControllerDelete(trackingVar.data.data[0].id);
                deletedCount++;
            }
        } catch (trackingError) {
            // Continue
        }

        // Send completion message
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: `Reset complete! Deleted ${deletedCount} old variables. All players should use /initquests for fresh quests.`
        });

    } catch (error) {
        // Send error message but don't fail the cronjob
        await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
            message: 'Daily reset encountered issues. Some cleanup may be incomplete.'
        });
    }
}

await main();