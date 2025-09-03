// =====================================
// FILE 3: questTracker.js
// =====================================
import { takaro, data } from '@takaro/helpers';

async function getPlayerName(playerId, fallback = null) {
  // Try to get the player name from Takaro API
  try {
    const playerRes = await takaro.player.playerControllerGetOne(playerId);
    if (playerRes?.data?.data?.name) {
      return playerRes.data.data.name;
    }
  } catch (e) { }
  return fallback || `Player_${playerId}`;
}

async function main() {
  const { gameServerId, module: mod } = data;
  const VARIABLE_KEY = 'lastQuestUpdate';
  const today = new Date().toDateString();

  // Helper for PM
  async function sendCompletionPM(playerId, questType) {
    const questNames = {
      timespent: 'TIME SURVIVOR',
      shopquest: 'TRADE BEERS',
      levelgain: 'EXPERIENCE GRINDER',
      zombiekills: 'ZOMBIE HUNTER',
      vote: 'SERVER SUPPORTER'
    };
    const playerName = await getPlayerName(playerId);
    await takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, {
      command: `pm "${playerName}" "?? Daily ${questNames[questType] || questType} quest completed! Use /dailyclaim to get your reward!"`
    });
  }

  try {
    // Get last run time
    const lastRunRes = await takaro.variable.variableControllerSearch({
      filters: {
        key: [VARIABLE_KEY],
        gameServerId: [gameServerId],
        moduleId: [mod.moduleId]
      }
    });

    const lastRun = lastRunRes.data.data.length ?
      new Date(lastRunRes.data.data[0].value) :
      new Date(Date.now() - 5 * 60 * 1000);

    // Zombie kills
    const killEvents = await takaro.event.eventControllerSearch({
      filters: {
        eventName: ['entity-killed'],
        gameserverId: [gameServerId]
      },
      greaterThan: { createdAt: lastRun.toISOString() },
      limit: 1000
    });

    for (const event of killEvents.data.data) {
      if (!event.playerId) continue;
      const playerId = event.playerId;
      const questKey = `dailyquest_${playerId}_${today}_zombiekills`;
      const questVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [questKey],
          gameServerId: [gameServerId],
          playerId: [playerId],
          moduleId: [mod.moduleId]
        }
      });
      if (questVar.data.data.length > 0) {
        const questData = JSON.parse(questVar.data.data[0].value);
        if (!questData.completed) {
          questData.progress = Math.min(questData.progress + 1, questData.target);
          const justCompleted = !questData.completed && questData.progress >= questData.target;
          if (justCompleted) {
            questData.completed = true;
            await sendCompletionPM(playerId, 'zombiekills');
          } else if (questData.progress >= questData.target) {
            questData.completed = true;
          }
          await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
            value: JSON.stringify(questData)
          });
        }
      }
    }

    // Shop quest
    const shopEvents = await takaro.event.eventControllerSearch({
      filters: {
        eventName: ['shop-order-status-changed'],
        gameserverId: [gameServerId]
      },
      greaterThan: { createdAt: lastRun.toISOString() },
      limit: 1000
    });

    for (const event of shopEvents.data.data) {
      if (!event.playerId) continue;
      const playerId = event.playerId;
      const questKey = `dailyquest_${playerId}_${today}_shopquest`;
      const questVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [questKey],
          gameServerId: [gameServerId],
          playerId: [playerId],
          moduleId: [mod.moduleId]
        }
      });
      if (questVar.data.data.length > 0) {
        const questData = JSON.parse(questVar.data.data[0].value);
        if (!questData.completed) {
          questData.progress = 1;
          questData.completed = true;
          await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
            value: JSON.stringify(questData)
          });
          await sendCompletionPM(playerId, 'shopquest');
        }
      }
    }

    // Level gain quest: You may want to update this if you track level up events via events, similar to above.

    // Update time for online players
    const onlinePlayers = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: {
        gameServerId: [gameServerId],
        online: [true]
      }
    });

    for (const playerOnServer of onlinePlayers.data.data) {
      const playerId = playerOnServer.playerId;
      const sessionKey = `session_${playerId}_${today}`;
      const timeQuestKey = `dailyquest_${playerId}_${today}_timespent`;

      // Get or create session
      let sessionVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [sessionKey],
          gameServerId: [gameServerId],
          playerId: [playerId],
          moduleId: [mod.moduleId]
        }
      });

      const currentTime = Date.now();
      let sessionData;

      if (sessionVar.data.data.length > 0) {
        sessionData = JSON.parse(sessionVar.data.data[0].value);
        const timeSinceLastUpdate = Math.min(currentTime - sessionData.lastUpdate, 5 * 60 * 1000);
        sessionData.totalTime += timeSinceLastUpdate;
        sessionData.lastUpdate = currentTime;

        await takaro.variable.variableControllerUpdate(sessionVar.data.data[0].id, {
          value: JSON.stringify(sessionData)
        });
      } else {
        sessionData = {
          startTime: currentTime,
          totalTime: 0,
          lastUpdate: currentTime
        };

        await takaro.variable.variableControllerCreate({
          key: sessionKey,
          value: JSON.stringify(sessionData),
          gameServerId: gameServerId,
          playerId: playerId,
          moduleId: mod.moduleId
        });
      }

      // Update time quest (cap at target, send PM on first completion)
      let timeQuestVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [timeQuestKey],
          gameServerId: [gameServerId],
          playerId: [playerId],
          moduleId: [mod.moduleId]
        }
      });

      if (timeQuestVar.data.data.length > 0) {
        const questData = JSON.parse(timeQuestVar.data.data[0].value);
        if (!questData.completed) {
          questData.progress = sessionData.totalTime;
          let justCompleted = false;
          if (questData.progress >= questData.target) {
            questData.progress = questData.target; // cap at target
            justCompleted = true;
            questData.completed = true;
            await sendCompletionPM(playerId, 'timespent');
          }
          await takaro.variable.variableControllerUpdate(timeQuestVar.data.data[0].id, {
            value: JSON.stringify(questData)
          });
        }
      }
    }

    // Update timestamp
    if (lastRunRes.data.data.length) {
      await takaro.variable.variableControllerUpdate(lastRunRes.data.data[0].id, {
        value: new Date().toISOString()
      });
    } else {
      await takaro.variable.variableControllerCreate({
        key: VARIABLE_KEY,
        value: new Date().toISOString(),
        gameServerId,
        moduleId: mod.moduleId
      });
    }

  } catch (error) {
    // Error logged by system
  }
}

await main();