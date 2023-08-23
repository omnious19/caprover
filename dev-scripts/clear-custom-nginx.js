/*jshint esversion: 6 */

const fs = require('fs-extra');
const CONFIG_FILE_PATH = '/dockstation/data/config-dockstationjson';

const fileContent = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, {
    encoding: 'utf-8'
}));

fs.writeFileSync(CONFIG_FILE_PATH + '.backup', JSON.stringify(fileContent));


fileContent.nginxBaseConfig = '';
fileContent.nginxDockStationConfig = '';

const apps = fileContent.appDefinitions || {};

Object.keys(apps).forEach(app => {
    apps[app].customNginxConfig = '';
});

fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(fileContent));