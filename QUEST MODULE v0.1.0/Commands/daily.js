// =====================================
// FILE 5: daily.js 
// =====================================
import { takaro, data, TakaroUserError } from '@takaro/helpers';
import { getPragueDate } from '../Functions/questConfig.js';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const today = getPragueDate();
    const playerId = pog.playerId;

    try {
        // Get today's active quest types
        const activeTypesKey = `dailyquests_active_types_${today}`;
        let activeTypes = ['vote', 'timespent', 'zombiekills']; // Default fallback
        
        try {
            const activeTypesVar = await takaro.variable.variableControllerSearch({
                filters: {
                    key: [activeTypesKey],
                    gameServerId: [gameServerId],
                    moduleId: [mod.moduleId]
                }
            });
            if (activeTypesVar?.data?.data?.length > 0) {
                activeTypes = JSON.parse(activeTypesVar.data.data[0].value);
            }
        } catch (e) { }

        const allQuests = [];

        for (const type of activeTypes) {
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
                    try {
                        const value = questVar.data.data[0].value;
                        const questData = JSON.parse(value);
                        if (typeof questData !== "object" || !questData.type) {
                            throw new Error(`Quest data missing type: ${JSON.stringify(questData)}`);
                        }
                        allQuests.push(questVar.data.data[0]);
                    } catch (parseErr) {
                        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                            command: `pm "${player.name}" "Quest data error for type ${type}: ${parseErr.message}"`
                        });
                    }
                }
            } catch (searchError) {
                // Quest doesn't exist
            }
        }

        if (allQuests.length === 0) {
            await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                command: `pm "${player.name}" "No daily quests found! Use /initquests to create them."`
            });
            return;
        }

        const questDescriptions = {
            timespent: { name: 'TIME SURVIVOR' },
            vote: { name: 'SERVER SUPPORTER' },
            zombiekills: { name: 'ZOMBIE HUNTER' },
            levelgain: { name: 'EXPERIENCE GRINDER' },
            shopquest: { name: 'TRADE BEERS' }
        };

        let claimedCount = 0;
        let readyCount = 0;
        let activeQuests = [];

        for (const questVar of allQuests) {
            let questData;
            try {
                questData = JSON.parse(questVar.value);
            } catch (e) {
                await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
                    command: `pm "${player.name}" "Quest data corrupted for a quest. Please use /initquests or contact admin."`
                });
                continue;
            }

            if (questData.claimed) {
                claimedCount++;
            } else {
                activeQuests.push(questVar);
                if (questData.completed) {
                    readyCount++;
                }
            }
        }

        // Single compact PM with BMP-safe icons
        let questStatus = `✪ DAILY QUESTS ${claimedCount}/${allQuests.length} ✪ `;

        for (const questVar of activeQuests) {
            let questData;
            try {
                questData = JSON.parse(questVar.value);
            } catch (e) {
                continue;
            }
            const questType = questData.type;
            const questInfo = questDescriptions[questType];

            if (questInfo) {
                let progressText = '';
                if (questType === 'timespent') {
                    const hours = Math.floor(questData.progress / 3600000);
                    const minutes = Math.floor((questData.progress % 3600000) / 60000);
                    const targetHours = Math.floor(questData.target / 3600000);
                    progressText = `${hours}h${minutes}m/${targetHours}h`;
                } else {
                    progressText = `${questData.progress}/${questData.target}`;
                }

                let status = questData.completed ? '✔ READY' : (questData.claimed ? 'CLAIMED' : 'in progress');
                questStatus += `※ ${questInfo.name}: ${status} | ${progressText} `;
            }
        }

        if (readyCount > 0) {
            questStatus += `※ Auto-claim active, rewards coming soon!`;
        } else if (activeQuests.length > 0) {
            questStatus += `※ Keep playing to complete quests!`;
        } else {
            questStatus += `※ All daily quests completed! Well done!`;
        }

        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "${questStatus}"`
        });

    } catch (error) {
        throw new TakaroUserError('Error retrieving daily quests: ' + (error.message || error));
    }
}

await main();