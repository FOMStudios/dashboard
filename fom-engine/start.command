#!/bin/bash
# Double-click to run the FOM Engine in a Terminal window (if you did not let setup.sh start it at login).
cd "$(dirname "$0")"
launchctl bootout "gui/$(id -u)/za.co.fomstudios.engine" 2>/dev/null
exec node server.js
