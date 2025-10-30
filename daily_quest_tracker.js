// daily_quest_tracker.js v0.3.29

class DailyQuestTracker {
    constructor() {
        this.quests = [];
    }

    addQuest(quest) {
        this.quests.push(quest);
    }

    checkAllDone(playerId = null) {
        let allDone = true;
        this.quests.forEach(quest => {
            if (!quest.isDone(playerId)) {
                allDone = false;
            }
        });
        return allDone;
    }

    // This function searches the doneKey with or without playerId
    searchDoneKey(doneKey, playerId = null) {
        return this.quests.filter(quest => {
            if (playerId) {
                return quest.doneKey === doneKey && quest.playerId === playerId;
            }
            return quest.doneKey === doneKey;
        });
    }
}

// Example usage:
const tracker = new DailyQuestTracker();
tracker.addQuest({ doneKey: 'quest1', playerId: 'player1', isDone: (id) => id ? this.playerId === id : true });

console.log(tracker.checkAllDone()); // Check if all quests are done
console.log(tracker.searchDoneKey('quest1')); // Search doneKey without playerId
console.log(tracker.searchDoneKey('quest1', 'player1')); // Search doneKey with playerId