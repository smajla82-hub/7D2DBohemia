#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/steam/backups"
WORLD_DIR="/home/steam/.local/share/7DaysToDie/Saves"

mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/7d2d_backup_$DATE.tar.gz $WORLD_DIR
echo "Backup created: 7d2d_backup_$DATE.tar.gz"

# Keep only last 7 backups
cd $BACKUP_DIR
ls -t *.tar.gz | tail -n +8 | xargs rm -f
