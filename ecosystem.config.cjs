const path = require('path');

module.exports = {
  apps: [
    // ── Long-running daemons ──

    {
      name: 'pan-bot',
      script: 'scripts/telegram-bot.js',
      cwd: __dirname,
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' },
    },

    {
      name: 'realtime-listener',
      script: 'scripts/realtime-listener.js',
      cwd: __dirname,
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' },
    },

    // ── Scheduled jobs (cron) ──

    {
      name: 'enrichment',
      script: 'scripts/enrichment.js',
      cwd: __dirname,
      cron_restart: '*/30 * * * *',   // every 30 minutes
      autorestart: false,              // don't restart after exit, only on cron
      watch: false,
      env: { NODE_ENV: 'production' },
    },

    {
      name: 'milestone-checker',
      script: 'scripts/milestone-checker.js',
      cwd: __dirname,
      cron_restart: '5,35 * * * *',   // 5 min after each enrichment run
      autorestart: false,
      watch: false,
      env: { NODE_ENV: 'production' },
    },

    {
      name: 'deployment-tracker',
      script: 'scripts/deployment-tracker.js',
      cwd: __dirname,
      cron_restart: '*/15 * * * *',   // poll Twitter every 15 minutes
      autorestart: false,
      watch: false,
      env: { NODE_ENV: 'production' },
    },

    {
      name: 'nightly-recap',
      script: 'scripts/nightly-recap.js',
      cwd: __dirname,
      cron_restart: '0 6 * * *',      // daily at 06:00 UTC
      autorestart: false,
      watch: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
