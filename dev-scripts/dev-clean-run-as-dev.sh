#!/bin/sh

if ! [ $(id -u) = 0 ]; then
   echo "Must run as sudo or root"
   exit 1
fi

pwd > currentdirectory
docker service rm $(docker service ls -q)
sleep 1s
docker secret rm dockstation-salt
docker build -t dockstation-debug -f dockerfile-dockstationdebug .
rm -rf /dockstation && mkdir /dockstation
chmod -R 777 /dockstation
docker run \
   -e "DOCKSTATION_IS_DEBUG=1" \
   -e "MAIN_NODE_IP_ADDRESS=127.0.0.1" \
   -v /var/run/docker.sock:/var/run/docker.sock \
   -v /dockstation:/dockstation \
   -v $(pwd):/usr/src/app dockstation-debug
sleep 2s
docker service logs dockstation-dockstation --follow
