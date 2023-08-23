import fs = require('fs-extra')
import path = require('path')
import EnvVars from './EnvVars'

const DOCKSTATION_BASE_DIRECTORY = '/dockstation'
const DOCKSTATION_DATA_DIRECTORY = DOCKSTATION_BASE_DIRECTORY + '/data' // data that sits here can be backed up
const DOCKSTATION_ROOT_DIRECTORY_TEMP = DOCKSTATION_BASE_DIRECTORY + '/temp'
const DOCKSTATION_ROOT_DIRECTORY_GENERATED = DOCKSTATION_BASE_DIRECTORY + '/generated'

const CONSTANT_FILE_OVERRIDE_BUILD = path.join(
    __dirname,
    '../../config-override.json'
)
const CONSTANT_FILE_OVERRIDE_USER =
    DOCKSTATION_DATA_DIRECTORY + '/config-override.json'

const configs = {
    publishedNameOnDockerHub: 'caprover/caprover',

    version: '1.10.1',

    defaultMaxLogSize: '512m',

    buildLogSize: 50,

    appLogSize: 500,

    maxVersionHistory: 50,

    skipVerifyingDomains: false,

    enableDockerLogsTimestamp: true,

    registrySubDomainPort: 996,

    dockerApiVersion: 'v1.40',

    netDataImageName: 'caprover/netdata:v1.34.1',

    registryImageName: 'registry:2',

    appPlaceholderImageName: 'caprover/caprover-placeholder-app:latest',

    nginxImageName: 'nginx:1',

    defaultEmail: 'runner@caprover.com',

    dockstationSubDomain: 'dockstation',

    overlayNetworkOverride: {},

    useExistingSwarm: false,

    proApiDomains: ['https://pro.caprover.com'],

    analyticsDomain: 'https://analytics-v1.caprover.com',
}

const data = {
    configs: configs, // values that can be overridden

    // ******************** Global Constants *********************

    apiVersion: 'v2',

    isDebug: EnvVars.DOCKSTATION_IS_DEBUG,

    dockstationServiceExposedPort: 3000,

    rootNameSpace: 'dockstation',

    // *********************** Disk Paths ************************

    defaultDockStationDefinitionPath: './dockstation-definition',

    dockerSocketPath: '/var/run/docker.sock',

    sourcePathInContainer: '/usr/src/app',

    nginxStaticRootDir: '/usr/share/nginx',

    dockstationStaticFilesDir: DOCKSTATION_ROOT_DIRECTORY_GENERATED + '/static',

    nginxSharedPathOnNginx: '/nginx-shared',

    nginxDhParamFileName: 'dhparam.pem',

    nginxDefaultHtmlDir: '/default',

    letsEncryptEtcPathOnNginx: '/letencrypt/etc',

    nginxDomainSpecificHtmlDir: '/domains',

    dockstationConfirmationPath: '/.well-known/dockstation-identifier',

    dockstationBaseDirectory: DOCKSTATION_BASE_DIRECTORY,

    restoreTarFilePath: DOCKSTATION_BASE_DIRECTORY + '/backup.tar',

    restoreDirectoryPath: DOCKSTATION_BASE_DIRECTORY + '/restoring',

    dockstationRootDirectoryTemp: DOCKSTATION_ROOT_DIRECTORY_TEMP,

    dockstationRootDirectoryBackup: DOCKSTATION_ROOT_DIRECTORY_TEMP + '/backup',

    dockstationDownloadsDirectory: DOCKSTATION_ROOT_DIRECTORY_TEMP + '/downloads',

    dockstationRawSourceDirectoryBase: DOCKSTATION_ROOT_DIRECTORY_TEMP + '/image_raw',

    dockstationRootDirectoryGenerated: DOCKSTATION_ROOT_DIRECTORY_GENERATED,

    registryAuthPathOnHost: DOCKSTATION_ROOT_DIRECTORY_GENERATED + '/registry-auth', // this is a file

    baseNginxConfigPath: DOCKSTATION_ROOT_DIRECTORY_GENERATED + '/nginx/nginx.conf', // this is a file

    rootNginxConfigPath:
        DOCKSTATION_ROOT_DIRECTORY_GENERATED + '/nginx/conf.d/dockstation-root',

    perAppNginxConfigPathBase:
        DOCKSTATION_ROOT_DIRECTORY_GENERATED + '/nginx/conf.d',

    dockstationDataDirectory: DOCKSTATION_DATA_DIRECTORY,

    letsEncryptLibPath: DOCKSTATION_DATA_DIRECTORY + '/letencrypt/lib',

    letsEncryptEtcPath: DOCKSTATION_DATA_DIRECTORY + '/letencrypt/etc',

    registryPathOnHost: DOCKSTATION_DATA_DIRECTORY + '/registry',

    nginxSharedPathOnHost: DOCKSTATION_DATA_DIRECTORY + '/nginx-shared',

    debugSourceDirectory: '', // Only used in debug mode

    // ********************* Local Docker Constants  ************************

    certbotImageName: 'caprover/certbot-sleeping:v1.6.0',

    dockstationSaltSecretKey: 'dockstation-salt',

    nginxServiceName: 'dockstation-nginx',

    dockstationServiceName: 'dockstation-dockstation',

    certbotServiceName: 'dockstation-certbot',

    netDataContainerName: 'dockstation-netdata-container',

    registryServiceName: 'dockstation-registry',

    dockstationNetworkName: 'dockstation-overlay-network',

    dockstationRegistryUsername: 'dockstation',

    // ********************* HTTP Related Constants  ************************

    nginxPortNumber: 80,

    netDataRelativePath: '/net-data-monitor',

    healthCheckEndPoint: '/checkhealth',

    registrySubDomain: 'registry',

    headerCookieAuth: 'dockstationCookieAuth',

    headerAuth: 'x-dockstation-auth',

    headerAppToken: 'x-dockstation-app-token',

    headerNamespace: 'x-namespace',

    headerCapRoverVersion: 'x-caprover-version',

    // *********************     ETC       ************************

    disableFirewallCommand:
        'ufw allow 80,443,3000,996,7946,4789,2377/tcp; ufw allow 7946,4789,2377/udp; ',

    gitShaEnvVarKey: 'CAPROVER_GIT_COMMIT_SHA',
}

function overrideFromFile(fileName: string) {
    const overridingValuesConfigs = fs.readJsonSync(fileName, {
        throws: false,
    })

    if (overridingValuesConfigs) {
        for (const prop in overridingValuesConfigs) {
            // eslint-disable-next-line no-prototype-builtins
            if (!overridingValuesConfigs.hasOwnProperty(prop)) {
                continue
            }

            console.log(`Overriding ${prop} from ${fileName}`)
            // @ts-ignore
            configs[prop] = overridingValuesConfigs[prop]
        }
    }
}

overrideFromFile(CONSTANT_FILE_OVERRIDE_BUILD)

overrideFromFile(CONSTANT_FILE_OVERRIDE_USER)

if (data.isDebug) {
    const devDirectoryOnLocalMachine = fs
        .readFileSync(__dirname + '/../../currentdirectory')
        .toString()
        .trim()

    if (!devDirectoryOnLocalMachine) {
        throw new Error(
            'For development purposes, you need to assign your local directory here'
        )
    }

    data.debugSourceDirectory = devDirectoryOnLocalMachine
    data.configs.publishedNameOnDockerHub = 'dockstation-debug'
    data.nginxPortNumber = 80
}

export default data
