#!/bin/sh
# Render the Icecast config from env (ADR D10: secrets via env, never in repo)
# then run Icecast in the foreground.
set -eu

: "${ICECAST_SOURCE_PASSWORD:?missing}"
: "${ICECAST_ADMIN_PASSWORD:?missing}"
: "${ICECAST_ADMIN_USER:=admin}"
export ICECAST_ADMIN_USER

envsubst < /etc/icecast2/icecast.xml.template > /etc/icecast2/icecast.xml

# Icecast logs to real files (it can't re-open the container's stdout after the
# privilege drop). Surface them via tail (writes to its inherited stdout). Don't
# pre-create the files as root — Icecast creates them as the icecast2 user in the
# world-writable logdir; `tail -F` waits for them to appear.
tail -F /var/log/icecast2/error.log /var/log/icecast2/access.log 2>/dev/null &

exec icecast2 -c /etc/icecast2/icecast.xml
