#!/bin/bash
# Autonomous deployment tracker - runs via cron
cd /home/kuusho/ideation-labs/megashETH-labs/deployment-tracker
node scripts/deployment-tracker.js >> deployment-tracker.log 2>&1
