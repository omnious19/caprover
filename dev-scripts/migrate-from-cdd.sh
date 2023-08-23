#!/bin/sh

# Run this script on the server to migrate from DockStationDuckDuck.

cd / && \
docker pull caprover/caprover && \
docker service scale dockstation-dockstation=0 && \
docker service rm dockstation-certbot dockstation-nginx && \
(docker service rm dockstation-registry || true) && \
sleep 3s && echo "waiting..." && sleep 3s && echo "waiting..." && \
rm -rf /dockstation/generated && rm -rf /dockstation/temp && \
tar -cvf /dockstation-bk-$(date +%Y_%m_%d_%H_%M_%S).tar /dockstation && \
mkdir -p /dockstation/data && \
mv /dockstation/letencrypt /dockstation/data/ && \
mv /dockstation/nginx-shared /dockstation/data/ && \
mv /dockstation/registry /dockstation/data/ && \
mv /dockstation/config.conf /dockstation/data/ && \
docker service update --image caprover/caprover dockstation-dockstation && \
docker service scale dockstation-dockstation=1 --detach && \
docker service logs dockstation-dockstation --follow