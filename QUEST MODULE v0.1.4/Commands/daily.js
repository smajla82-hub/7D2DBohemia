// =====================================
// FILE 3: daily.js (Command)
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
                    allQuests.push(questVar.data.data[0]);
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
            const questData = JSON.parse(questVar.value);

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
            const questData = JSON.parse(questVar.value);
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
        throw new TakaroUserError('Error retrieving daily quests.');
    }
}

await main();