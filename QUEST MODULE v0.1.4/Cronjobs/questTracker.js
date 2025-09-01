import { takaro, data } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const VARIABLE_KEY = 'lastQuestUpdate';
  const today = new Date().toDateString();

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

    // Get zombie kill events (same method as economy module)
    const killEvents = await takaro.event.eventControllerSearch({
      filters: {
        eventName: ['entity-killed'],
        gameserverId: [gameServerId]
      },
      greaterThan: { createdAt: lastRun.toISOString() },
      limit: 1000
    });

    // Process each kill event
    for (const event of killEvents.data.data) {
      if (!event.playerId) continue;

      const playerId = event.playerId;
      const killQuestKey = `dailyquest_${playerId}_${today}_zombiekills`;

      const questVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [killQuestKey],
          gameServerId: [gameServerId],
          playerId: [playerId],
          moduleId: [mod.moduleId]
        }
      });

      if (questVar.data.data.length > 0) {
        const questData = JSON.parse(questVar.data.data[0].value);

        if (!questData.completed) {
          questData.progress = Math.min(questData.progress + 1, questData.target);

          if (questData.progress >= questData.target) {
            questData.completed = true;
          }

          await takaro.variable.variableControllerUpdate(questVar.data.data[0].id, {
            value: JSON.stringify(questData)
          });
        }
      }
    }

    // Get shop events
    const shopEvents = await takaro.event.eventControllerSearch({
      filters: {
        eventName: ['shop-order-status-changed'],
        gameserverId: [gameServerId]
      },
      greaterThan: { createdAt: lastRun.toISOString() },
      limit: 1000
    });

    // Process shop events
    for (const event of shopEvents.data.data) {
      if (!event.playerId) continue;

      const playerId = event.playerId;
      const shopQuestKey = `dailyquest_${playerId}_${today}_shopquest`;

      const questVar = await takaro.variable.variableControllerSearch({
        filters: {
          key: [shopQuestKey],
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
        }
      }
    }

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

      // Update time quest
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
        questData.progress = sessionData.totalTime;

        if (questData.progress >= questData.target && !questData.completed) {
          questData.completed = true;
        }

        await takaro.variable.variableControllerUpdate(timeQuestVar.data.data[0].id, {
          value: JSON.stringify(questData)
        });
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