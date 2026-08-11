module.exports = {
  apps: [
    {
      name: "game-monitor",
      script: "/home/steam/7D2DBohemia/integrated-game-monitor/integrated_game_monitor.py",
      interpreter: "python3",
      cwd: "/home/steam/7D2DBohemia/integrated-game-monitor",
      watch: false
    },
    {
      name: "voting-rewards",
      script: "/home/steam/7D2DBohemia/voting/voting_rewards.py",
      interpreter: "python3",
      cwd: "/home/steam/7D2DBohemia/voting",
      watch: false
    },
    {
      name: "takaro-server",
      script: "working_server.js",
      interpreter: "node",
      cwd: "/home/steam/7D2DBohemia/quest-integration-server",
      watch: false
    }
  ]
};
