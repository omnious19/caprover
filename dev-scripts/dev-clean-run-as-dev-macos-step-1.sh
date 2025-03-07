#!/bin/sh

if ! [ $(id -u) = 0 ]; then
   echo "Must run as sudo or root"
   exit 1
fi

# on macos Catalina and above, /dockstation is a symb link. we cannot remove the folder so we delete all files inside
# rm -rf /dockstation && mkdir /dockstation
rm -rf /dockstation/*
chmod -R 777 /dockstation/
