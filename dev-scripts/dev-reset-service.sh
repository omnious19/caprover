#!/bin/sh

if ! [ $(id -u) = 0 ]; then
   echo "Must run as sudo or root"
   exit 1
fi

sudo docker service update dockstation-dockstation --force
sleep 2s
sudo docker service logs dockstation-dockstation --follow --since 2m
