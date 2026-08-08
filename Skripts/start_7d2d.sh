#!/bin/bash
cd /home/steam/7d2d-server
./7DaysToDieServer.x86_64 \
    -configfile=serverconfig.xml \
    -logfile /home/steam/7d2d-server/logs/$(date +%Y%m%d_%H%M%S)_output_log.txt \
    -quit -batchmode -nographics -dedicated
