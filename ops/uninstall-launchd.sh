#!/bin/bash
# install-launchd.sh로 등록한 LaunchAgent를 내리고 지운다. 로그와 백업은 남긴다.
set -uo pipefail

domain="gui/$(id -u)"
for label in com.claude-hub.server com.claude-hub.backup; do
  launchctl bootout "$domain/$label" 2>/dev/null && echo "$label 내림"
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
