#!/bin/sh

if ! [ $(id -u) <> 0 ]; then
   echo "Must not be run as sudo or root on macos (macos security) please run the step 1 as root and this step as standard user"
   exit 1
fi

docker service rm $(docker service ls -q)
sleep 1
docker secret rm dockstation-salt
docker build -t dockstation-debug -f dockerfile-dockstationdebug .
docker run \
   -e "DOCKSTATION_IS_DEBUG=1" \
   -e "MAIN_NODE_IP_ADDRESS=127.0.0.1" \
   -v /var/run/docker.sock:/var/run/docker.sock \
   -v /dockstation:/dockstation \
   -v $(pwd):/usr/src/app dockstation-debug
sleep 2s
docker service logs dockstation-dockstation --follow
