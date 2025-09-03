// =====================================
// FILE 5: daily.js 
// =====================================
import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;
    const today = new Date().toDateString();
    const playerId = pog.playerId;

    try {
        const questTypes = ['timespent', 'vote', 'zombiekills', 'levelgain', 'shopquest'];
        const allQuests = [];

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
                    try {
                        // Defensive: ensure value is valid JSON and has needed fields
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
                        // Optionally, continue to next quest type
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

        let questStatus = `=DAILY QUEST PROGRESS ${claimedCount}/${allQuests.length}= `;

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

                let status = questData.completed ? 'READY' : 'in progress';
                questStatus += `*** ${questInfo.name}: ${status} | ${progressText} `;
            }
        }

        if (readyCount > 0) {
            questStatus += `*** ${readyCount} quests ready! Use /dailyclaim`;
        } else if (activeQuests.length > 0) {
            questStatus += `*** Keep playing to complete quests!`;
        } else {
            questStatus += `*** All daily quests completed! Well done!`;
        }

        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm "${player.name}" "${questStatus}"`
        });

    } catch (error) {
        throw new TakaroUserError('Error retrieving daily quests: ' + (error.message || error));
    }
}


await main();