#!/bin/bash

# Run the following line on a PlayWithDocker instance
#  curl -L https://pwd.caprover.com | bash

sleepWithTimer(){
    secs=${1}
    while [ $secs -gt 0 ]; do
        echo -ne "  Waiting $secs seconds... \033[0K\r"
        sleep 1
        : $((secs--))
    done
}

if [[ -z "${PWD_HOST_FQDN}" ]]; then
  echo "ERROR: this script is only meant to be used on play-with-docker.com environment" && exit 127
else
  echo "Installing and setting up CapRover on play-with-docker.com environment"
fi

docker run -e MAIN_NODE_IP_ADDRESS='127.0.0.1' -p 80:80 -p 443:443 -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock -v /dockstation:/dockstation caprover/caprover

IP_WITH_DASH=`ifconfig eth1 | grep 'inet addr' | cut -d: -f2 | awk '{print $1}'  | sed 's/\./-/g'`
##  ip172-18-0-34-bo5qqunad2eg00a35t5g-80.direct.labs.play-with-docker.com
CAPROVER_ROOT_DOMAIN="ip${IP_WITH_DASH}-${SESSION_ID}-80.direct.labs.play-with-docker.com"
echo "CapRover Root Domain: ${CAPROVER_ROOT_DOMAIN}"


echo "=============================================="
echo "=============================================="
echo "Waiting for CapRover to finish installation..."
echo "=============================================="
echo "=============================================="
echo " "
echo " "
echo " "
DOCKSTATION_INITED=""
while [[ -z "${DOCKSTATION_INITED}" ]];do 
    DOCKSTATION_INITED=`docker service logs dockstation-dockstation --since 3s | grep "DockStation is initialized"`
    docker service logs dockstation-dockstation --since 2s
    sleep 2 
done 

echo " "
echo " "
echo "Setting up the root URL... "
echo " "
docker service scale dockstation-dockstation=0
sleepWithTimer 6
echo "{
        \"namespace\": \"dockstation\",
        \"customDomain\": \"${CAPROVER_ROOT_DOMAIN}\"
}" > /dockstation/data/config-dockstationjson
cat /dockstation/data/config-dockstationjson
echo  "{\"skipVerifyingDomains\":\"true\"}" >  /dockstation/data/config-override.json
docker container prune --force
docker service scale dockstation-dockstation=1


echo "==================================="
echo "==================================="
echo "Waiting for CapRover to finalize..."
echo "==================================="
echo "==================================="
echo " "
echo " "
sleepWithTimer 6

DOCKSTATION_INITED=""
while [[ -z "${DOCKSTATION_INITED}" ]];do 
    DOCKSTATION_INITED=`docker service logs dockstation-dockstation --since 3s | grep "DockStation is initialized"`
    docker service logs dockstation-dockstation --since 2s
    sleep 2 
done 


echo " "
echo " "
echo " "
echo "==================================="
echo "==================================="
echo " **** Installation is done! *****  "
echo "CapRover is available at http://dockstation${CAPROVER_ROOT_DOMAIN}"
echo "Default password is: dockstation42"
echo "==================================="
echo "==================================="

