import { takaro, data, TakaroUserError } from '@takaro/helpers';

async function main() {
    const { player, pog, gameServerId, module: mod } = data;

    const today = new Date().toDateString();
    const playerId = pog.playerId;

    try {
        // Get all daily quests
        const questTypes = ['timespent', 'vote', 'zombiekills', 'levelgain', 'traderquests'];
        const allQuests = [];

        for (const questType of questTypes) {
            try {
                const questVar = await takaro.variable.variableControllerSearch({
                    filters: {
                        key: [`dailyquest_${playerId}_${today}_${questType}`],
                        gameServerId: [gameServerId],
                        playerId: [playerId],
                        moduleId: [mod.moduleId]
                    }
                });

                if (questVar && questVar.data && questVar.data.data && questVar.data.data.length > 0) {
                    allQuests.push(questVar.data.data[0]);
                }
            } catch (searchError) {
                // Skip this quest type if error
            }
        }

        if (allQuests.length === 0) {
            throw new TakaroUserError('No daily quests found. Use /initquests to create them.');
        }

        const questDescriptions = {
            timespent: { name: 'TIME SURVIVOR' },
            vote: { name: 'SERVER SUPPORTER' },
            zombiekills: { name: 'ZOMBIE HUNTER' },
            levelgain: { name: 'EXPERIENCE GRINDER' },
            traderquests: { name: 'TRADER FRIEND' }
        };

        // Count completed/claimed quests for the title counter
        let totalQuests = allQuests.length;
        let claimedCount = 0;
        let readyCount = 0;
        let activeQuests = []; // Only show unclaimed quests

        for (const questVar of allQuests) {
            const questData = JSON.parse(questVar.value);

            if (questData.claimed) {
                claimedCount++;
            } else {
                // Only add unclaimed quests to display
                activeQuests.push(questVar);
                if (questData.completed) {
                    readyCount++;
                }
            }
        }

        // Create title with progress counter
        let questStatus = `=DAILY QUEST PROGRESS ${claimedCount}/${totalQuests}= `;

        // Show only unclaimed quests
        for (const questVar of activeQuests) {
            const questData = JSON.parse(questVar.value);
            const questType = questData.type;
            const questInfo = questDescriptions[questType];

            if (questInfo) {
                let progressText = '';
                if (questType === 'timespent') {
                    const hours = Math.floor(questData.progress / 3600000);
                    const minutes = Math.floor((questData.progress % 3600000) / 60000);
                    const targetMinutes = Math.floor(questData.target / 60000);
                    progressText = `${hours}h${minutes}m/${targetMinutes}m`;
                } else {
                    progressText = `${questData.progress}/${questData.target}`;
                }

                let status = 'in progress';
                if (questData.completed) {
                    status = 'READY';
                }

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

        // Send as proper private message
        await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
            command: `pm ${player.name} "${questStatus}"`
        });

    } catch (error) {
        if (error instanceof TakaroUserError) {
            throw error;
        }
        throw new TakaroUserError('Error retrieving daily quests.');
    }
}

await main();