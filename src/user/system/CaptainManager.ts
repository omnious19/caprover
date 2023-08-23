import { v4 as uuid } from 'uuid'
import ApiStatusCodes from '../../api/ApiStatusCodes'
import DataStore from '../../datastore/DataStore'
import DataStoreProvider from '../../datastore/DataStoreProvider'
import DockerApi from '../../docker/DockerApi'
import { IRegistryInfo, IRegistryTypes } from '../../models/IRegistryInfo'
import DockStationConstants from '../../utils/DockStationConstants'
import Logger from '../../utils/Logger'
import MigrateDockStationDuckDuck from '../../utils/MigrateDockStationDuckDuck'
import Utils from '../../utils/Utils'
import Authenticator from '../Authenticator'
import FeatureFlags from '../FeatureFlags'
import ServiceManager from '../ServiceManager'
import { EventLoggerFactory } from '../events/EventLogger'
import {
    CapRoverEventFactory,
    CapRoverEventType,
} from '../events/ICapRoverEvent'
import ProManager from '../pro/ProManager'
import BackupManager from './BackupManager'
import CertbotManager from './CertbotManager'
import DomainResolveChecker from './DomainResolveChecker'
import LoadBalancerManager from './LoadBalancerManager'
import SelfHostedDockerRegistry from './SelfHostedDockerRegistry'
import request = require('request')
import fs = require('fs-extra')

const DEBUG_SALT = 'THIS IS NOT A REAL CERTIFICATE'

const MAX_FAIL_ALLOWED = 4
const HEALTH_CHECK_INTERVAL = 20000 // ms
const TIMEOUT_HEALTH_CHECK = 15000 // ms
interface ISuccessCallback {
    (success: boolean): void
}

class DockStationManager {
    private hasForceSsl: boolean
    private dataStore: DataStore
    private dockerApi: DockerApi
    private certbotManager: CertbotManager
    private loadBalancerManager: LoadBalancerManager
    private domainResolveChecker: DomainResolveChecker
    private dockerRegistry: SelfHostedDockerRegistry
    private backupManager: BackupManager
    private myNodeId: string | undefined
    private inited: boolean
    private waitUntilRestarted: boolean
    private dockstationSalt: string
    private consecutiveHealthCheckFailCount: number
    private healthCheckUuid: string

    constructor() {
        const dockerApi = DockerApi.get()

        this.hasForceSsl = false
        this.dataStore = DataStoreProvider.getDataStore(
            DockStationConstants.rootNameSpace
        )
        this.dockerApi = dockerApi
        this.certbotManager = new CertbotManager(dockerApi)
        this.loadBalancerManager = new LoadBalancerManager(
            dockerApi,
            this.certbotManager,
            this.dataStore
        )
        this.domainResolveChecker = new DomainResolveChecker(
            this.loadBalancerManager,
            this.certbotManager
        )
        this.myNodeId = undefined
        this.inited = false
        this.waitUntilRestarted = false
        this.dockstationSalt = ''
        this.consecutiveHealthCheckFailCount = 0
        this.healthCheckUuid = uuid()
        this.backupManager = new BackupManager()
    }

    initialize() {
        // If a linked file / directory is deleted on the host, it loses the connection to
        // the container and needs an update to be picked up again.

        const self = this
        const dataStore = this.dataStore
        const dockerApi = this.dockerApi
        const loadBalancerManager = this.loadBalancerManager
        let myNodeId: string

        self.refreshForceSslState()
            .then(function () {
                return dockerApi.getNodeIdByServiceName(
                    DockStationConstants.dockstationServiceName,
                    0
                )
            })
            .then(function (nodeId) {
                myNodeId = nodeId
                self.myNodeId = myNodeId
                self.dockerRegistry = new SelfHostedDockerRegistry(
                    self.dockerApi,
                    self.dataStore,
                    self.certbotManager,
                    self.loadBalancerManager,
                    self.myNodeId
                )
                return dockerApi.isNodeManager(myNodeId)
            })
            .then(function (isManager) {
                if (!isManager) {
                    throw new Error('DockStation should only run on a manager node')
                }
            })
            .then(function () {
                Logger.d('Emptying generated and temp folders.')

                return fs.emptyDir(DockStationConstants.dockstationRootDirectoryTemp)
            })
            .then(function () {
                return fs.emptyDir(
                    DockStationConstants.dockstationRootDirectoryGenerated
                )
            })
            .then(function () {
                Logger.d('Ensuring directories are available on host. Started.')

                return fs.ensureDir(DockStationConstants.letsEncryptEtcPath)
            })
            .then(function () {
                return fs.ensureDir(DockStationConstants.letsEncryptLibPath)
            })
            .then(function () {
                return fs.ensureDir(DockStationConstants.dockstationStaticFilesDir)
            })
            .then(function () {
                return fs.ensureDir(DockStationConstants.perAppNginxConfigPathBase)
            })
            .then(function () {
                return fs.ensureFile(DockStationConstants.baseNginxConfigPath)
            })
            .then(function () {
                return fs.ensureDir(DockStationConstants.registryPathOnHost)
            })
            .then(function () {
                return dockerApi.ensureOverlayNetwork(
                    DockStationConstants.dockstationNetworkName,
                    DockStationConstants.configs.overlayNetworkOverride
                )
            })
            .then(function () {
                Logger.d(
                    'Ensuring directories are available on host. Finished.'
                )

                return dockerApi.ensureServiceConnectedToNetwork(
                    DockStationConstants.dockstationServiceName,
                    DockStationConstants.dockstationNetworkName
                )
            })
            .then(function () {
                const valueIfNotExist = DockStationConstants.isDebug
                    ? DEBUG_SALT
                    : uuid()
                return dockerApi.ensureSecret(
                    DockStationConstants.dockstationSaltSecretKey,
                    valueIfNotExist
                )
            })
            .then(function () {
                return dockerApi.ensureSecretOnService(
                    DockStationConstants.dockstationServiceName,
                    DockStationConstants.dockstationSaltSecretKey
                )
            })
            .then(function (secretHadExistedBefore) {
                if (!secretHadExistedBefore) {
                    return new Promise<void>(function () {
                        Logger.d(
                            'I am halting here. I expect to get restarted in a few seconds due to a secret (dockstation salt) being updated.'
                        )
                    })
                }
            })
            .then(function () {
                const secretFileName = `/run/secrets/${DockStationConstants.dockstationSaltSecretKey}`

                if (!fs.pathExistsSync(secretFileName)) {
                    throw new Error(
                        `Secret is attached according to Docker. But file cannot be found. ${secretFileName}`
                    )
                }

                const secretContent = fs.readFileSync(secretFileName).toString()

                if (!secretContent) {
                    throw new Error('Salt secret content is empty!')
                }

                self.dockstationSalt = secretContent

                return true
            })
            .then(function () {
                return Authenticator.setMainSalt(self.getDockStationSalt())
            })
            .then(function () {
                return dataStore.setEncryptionSalt(self.getDockStationSalt())
            })
            .then(function () {
                return new MigrateDockStationDuckDuck(
                    dataStore,
                    Authenticator.getAuthenticator(dataStore.getNameSpace())
                )
                    .migrateIfNeeded()
                    .then(function (migrationPerformed) {
                        if (migrationPerformed) {
                            return self.resetSelf()
                        }
                    })
            })
            .then(function () {
                return loadBalancerManager.init(myNodeId, dataStore)
            })
            .then(function () {
                return dataStore.getRegistriesDataStore().getAllRegistries()
            })
            .then(function (registries) {
                let localRegistry: IRegistryInfo | undefined = undefined

                for (let idx = 0; idx < registries.length; idx++) {
                    const element = registries[idx]
                    if (element.registryType === IRegistryTypes.LOCAL_REG) {
                        localRegistry = element
                    }
                }

                if (localRegistry) {
                    Logger.d('Ensuring Docker Registry is running...')
                    return self.dockerRegistry.ensureDockerRegistryRunningOnThisNode(
                        localRegistry.registryPassword
                    )
                }

                return Promise.resolve(true)
            })
            .then(function () {
                return self.backupManager.startRestorationIfNeededPhase2(
                    self.getDockStationSalt(),
                    () => {
                        return self.ensureAllAppsInited()
                    }
                )
            })
            .then(function () {
                self.inited = true

                self.performHealthCheck()

                EventLoggerFactory.get(
                    new ProManager(
                        self.dataStore.getProDataStore(),
                        FeatureFlags.get(self.dataStore)
                    )
                )
                    .getLogger()
                    .trackEvent(
                        CapRoverEventFactory.create(
                            CapRoverEventType.InstanceStarted,
                            {}
                        )
                    )

                Logger.d(
                    '**** DockStation is initialized and ready to serve you! ****'
                )
            })
            .catch(function (error) {
                Logger.e(error)

                setTimeout(function () {
                    process.exit(0)
                }, 5000)
            })
    }

    getDomainResolveChecker() {
        return this.domainResolveChecker
    }

    performHealthCheck() {
        const self = this
        const dockstationPublicDomain = `${
            DockStationConstants.configs.dockstationSubDomain
        }.${self.dataStore.getRootDomain()}`

        function scheduleNextHealthCheck() {
            self.healthCheckUuid = uuid()
            setTimeout(function () {
                self.performHealthCheck()
            }, HEALTH_CHECK_INTERVAL)
        }

        // For debug build, we'll turn off health check
        if (DockStationConstants.isDebug || !self.dataStore.hasCustomDomain()) {
            scheduleNextHealthCheck()
            return
        }

        function checkDockStationHealth(callback: ISuccessCallback) {
            let callbackCalled = false

            setTimeout(function () {
                if (callbackCalled) {
                    return
                }
                callbackCalled = true

                callback(false)
            }, TIMEOUT_HEALTH_CHECK)

            if (DockStationConstants.configs.skipVerifyingDomains) {
                setTimeout(function () {
                    if (callbackCalled) {
                        return
                    }
                    callbackCalled = true
                    callback(true)
                }, 10)
                return
            }

            const url = `http://${dockstationPublicDomain}${DockStationConstants.healthCheckEndPoint}`

            request(
                url,

                function (error, response, body) {
                    if (callbackCalled) {
                        return
                    }
                    callbackCalled = true

                    if (error || !body || body !== self.getHealthCheckUuid()) {
                        callback(false)
                    } else {
                        callback(true)
                    }
                }
            )
        }

        function checkNginxHealth(callback: ISuccessCallback) {
            let callbackCalled = false

            setTimeout(function () {
                if (callbackCalled) {
                    return
                }
                callbackCalled = true

                callback(false)
            }, TIMEOUT_HEALTH_CHECK)

            self.domainResolveChecker
                .verifyDockStationOwnsDomainOrThrow(
                    dockstationPublicDomain,
                    '-healthcheck'
                )
                .then(function () {
                    if (callbackCalled) {
                        return
                    }
                    callbackCalled = true

                    callback(true)
                })
                .catch(function () {
                    if (callbackCalled) {
                        return
                    }
                    callbackCalled = true

                    callback(false)
                })
        }

        interface IChecks {
            dockstationHealth: { value: boolean }
            nginxHealth: { value: boolean }
        }

        const checksPerformed = {} as IChecks

        function scheduleIfNecessary() {
            if (
                !checksPerformed.dockstationHealth ||
                !checksPerformed.nginxHealth
            ) {
                return
            }

            let hasFailedCheck = false

            if (!checksPerformed.dockstationHealth.value) {
                Logger.w(
                    `DockStation health check failed: #${self.consecutiveHealthCheckFailCount} at ${dockstationPublicDomain}`
                )
                hasFailedCheck = true
            }

            if (!checksPerformed.nginxHealth.value) {
                Logger.w(
                    `NGINX health check failed: #${self.consecutiveHealthCheckFailCount}`
                )
                hasFailedCheck = true
            }

            if (hasFailedCheck) {
                self.consecutiveHealthCheckFailCount =
                    self.consecutiveHealthCheckFailCount + 1
            } else {
                self.consecutiveHealthCheckFailCount = 0
            }

            scheduleNextHealthCheck()

            if (self.consecutiveHealthCheckFailCount > MAX_FAIL_ALLOWED) {
                process.exit(1)
            }
        }

        checkDockStationHealth(function (success) {
            checksPerformed.dockstationHealth = {
                value: success,
            }
            scheduleIfNecessary()
        })

        checkNginxHealth(function (success) {
            checksPerformed.nginxHealth = {
                value: success,
            }
            scheduleIfNecessary()
        })
    }

    getHealthCheckUuid() {
        return this.healthCheckUuid
    }

    getBackupManager() {
        return this.backupManager
    }

    getCertbotManager() {
        return this.certbotManager
    }

    isInitialized() {
        return (
            this.inited &&
            !this.waitUntilRestarted &&
            !this.backupManager.isRunning()
        )
    }

    ensureAllAppsInited() {
        const self = this
        return Promise.resolve() //
            .then(function () {
                return self.dataStore.getAppsDataStore().getAppDefinitions()
            })
            .then(function (apps) {
                const promises: (() => Promise<void>)[] = []
                const serviceManager = ServiceManager.get(
                    self.dataStore.getNameSpace(),
                    Authenticator.getAuthenticator(
                        self.dataStore.getNameSpace()
                    ),
                    self.dataStore,
                    self.dockerApi,
                    DockStationManager.get().getLoadBalanceManager(),
                    EventLoggerFactory.get(
                        new ProManager(
                            self.dataStore.getProDataStore(),
                            FeatureFlags.get(self.dataStore)
                        )
                    ).getLogger(),
                    DockStationManager.get().getDomainResolveChecker()
                )
                Object.keys(apps).forEach((appName) => {
                    promises.push(function () {
                        return Promise.resolve() //
                            .then(function () {
                                return serviceManager.ensureServiceInitedAndUpdated(
                                    appName
                                )
                            })
                            .then(function () {
                                Logger.d(
                                    `Waiting 5 second for the service to settle... ${appName}`
                                )
                                return Utils.getDelayedPromise(5000)
                            })
                    })
                })

                return Utils.runPromises(promises)
            })
    }

    getMyNodeId() {
        if (!this.myNodeId) {
            const msg = 'myNodeId is not set yet!!'
            Logger.e(msg)
            throw new Error(msg)
        }

        return this.myNodeId
    }

    getDockStationSalt() {
        if (!this.dockstationSalt) {
            const msg = 'DockStation Salt is not set yet!!'
            Logger.e(msg)
            throw new Error(msg)
        }

        return this.dockstationSalt
    }

    updateNetDataInfo(netDataInfo: NetDataInfo) {
        const self = this
        const dockerApi = this.dockerApi

        return Promise.resolve()
            .then(function () {
                return dockerApi.ensureContainerStoppedAndRemoved(
                    DockStationConstants.netDataContainerName,
                    DockStationConstants.dockstationNetworkName
                )
            })
            .then(function () {
                if (netDataInfo.isEnabled) {
                    const vols = [
                        {
                            hostPath: '/proc',
                            containerPath: '/host/proc',
                            mode: 'ro',
                        },
                        {
                            hostPath: '/sys',
                            containerPath: '/host/sys',
                            mode: 'ro',
                        },
                        {
                            hostPath: '/var/run/docker.sock',
                            containerPath: '/var/run/docker.sock',
                        },
                    ]

                    const envVars = []

                    if (netDataInfo.data.smtp) {
                        envVars.push({
                            key: 'SSMTP_TO',
                            value: netDataInfo.data.smtp.to,
                        })
                        envVars.push({
                            key: 'SSMTP_HOSTNAME',
                            value: netDataInfo.data.smtp.hostname,
                        })

                        envVars.push({
                            key: 'SSMTP_SERVER',
                            value: netDataInfo.data.smtp.server,
                        })

                        envVars.push({
                            key: 'SSMTP_PORT',
                            value: netDataInfo.data.smtp.port,
                        })

                        envVars.push({
                            key: 'SSMTP_TLS',
                            value: netDataInfo.data.smtp.allowNonTls
                                ? 'NO'
                                : 'YES',
                        })

                        envVars.push({
                            key: 'SSMTP_USER',
                            value: netDataInfo.data.smtp.username,
                        })

                        envVars.push({
                            key: 'SSMTP_PASS',
                            value: netDataInfo.data.smtp.password,
                        })

                        // See: https://github.com/titpetric/netdata#changelog
                        const otherEnvVars: any[] = []
                        envVars.forEach((e) => {
                            otherEnvVars.push({
                                // change SSMTP to SMTP
                                key: e.key.replace('SSMTP_', 'SMTP_'),
                                value: e.value,
                            })
                        })
                        envVars.push(...otherEnvVars)

                        envVars.push({
                            key: 'SMTP_STARTTLS',
                            value: netDataInfo.data.smtp.allowNonTls
                                ? ''
                                : 'on',
                        })
                    }

                    if (netDataInfo.data.slack) {
                        envVars.push({
                            key: 'SLACK_WEBHOOK_URL',
                            value: netDataInfo.data.slack.hook,
                        })
                        envVars.push({
                            key: 'SLACK_CHANNEL',
                            value: netDataInfo.data.slack.channel,
                        })
                    }

                    if (netDataInfo.data.telegram) {
                        envVars.push({
                            key: 'TELEGRAM_BOT_TOKEN',
                            value: netDataInfo.data.telegram.botToken,
                        })
                        envVars.push({
                            key: 'TELEGRAM_CHAT_ID',
                            value: netDataInfo.data.telegram.chatId,
                        })
                    }

                    if (netDataInfo.data.pushBullet) {
                        envVars.push({
                            key: 'PUSHBULLET_ACCESS_TOKEN',
                            value: netDataInfo.data.pushBullet.apiToken,
                        })
                        envVars.push({
                            key: 'PUSHBULLET_DEFAULT_EMAIL',
                            value: netDataInfo.data.pushBullet.fallbackEmail,
                        })
                    }

                    return dockerApi.createStickyContainer(
                        DockStationConstants.netDataContainerName,
                        DockStationConstants.configs.netDataImageName,
                        vols,
                        DockStationConstants.dockstationNetworkName,
                        envVars,
                        ['SYS_PTRACE'],
                        ['apparmor:unconfined'],
                        undefined
                    )
                }

                // Just removing the old container. No need to create a new one.
                return true
            })
            .then(function () {
                return self.dataStore.setNetDataInfo(netDataInfo)
            })
    }

    getNodesInfo() {
        const dockerApi = this.dockerApi

        return Promise.resolve()
            .then(function () {
                return dockerApi.getNodesInfo()
            })
            .then(function (data) {
                if (!data || !data.length) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'No cluster node was found!'
                    )
                }

                return data
            })
    }

    getLoadBalanceManager() {
        return this.loadBalancerManager
    }

    getDockerRegistry() {
        return this.dockerRegistry
    }

    enableSsl(emailAddress: string) {
        const self = this
        return Promise.resolve()
            .then(function () {
                return self.certbotManager.ensureRegistered(emailAddress)
            })
            .then(function () {
                return self.certbotManager.enableSsl(
                    `${
                        DockStationConstants.configs.dockstationSubDomain
                    }.${self.dataStore.getRootDomain()}`
                )
            })
            .then(function () {
                return self.dataStore.setUserEmailAddress(emailAddress)
            })
            .then(function () {
                return self.dataStore.setHasRootSsl(true)
            })
            .then(function () {
                Logger.d('Updating Load Balancer - DockStationManager.enableSsl')
                return self.loadBalancerManager.rePopulateNginxConfigFile(
                    self.dataStore
                )
            })
    }

    forceSsl(isEnabled: boolean) {
        const self = this
        return Promise.resolve()
            .then(function () {
                return self.dataStore.getHasRootSsl()
            })
            .then(function (hasRootSsl) {
                if (!hasRootSsl && isEnabled) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'You first need to enable SSL on the root domain before forcing it.'
                    )
                }

                return self.dataStore.setForceSsl(isEnabled)
            })
            .then(function () {
                return self.refreshForceSslState()
            })
    }

    refreshForceSslState() {
        const self = this
        return Promise.resolve()
            .then(function () {
                return self.dataStore.getForceSsl()
            })
            .then(function (hasForceSsl) {
                self.hasForceSsl = hasForceSsl
            })
    }

    getForceSslValue() {
        return !!this.hasForceSsl
    }

    getNginxConfig() {
        const self = this
        return Promise.resolve().then(function () {
            return self.dataStore.getNginxConfig()
        })
    }

    setNginxConfig(baseConfig: string, dockstationConfig: string) {
        const self = this
        return Promise.resolve()
            .then(function () {
                return self.dataStore.setNginxConfig(baseConfig, dockstationConfig)
            })
            .then(function () {
                self.resetSelf()
            })
    }

    changeDockStationRootDomain(requestedCustomDomain: string, force: boolean) {
        const self = this
        // Some DNS servers do not allow wild cards. Therefore this line may fail.
        // We still allow users to specify the domains in their DNS settings individually
        // SubDomains that need to be added are "dockstation" "registry." "app-name."
        const url = `${uuid()}.${requestedCustomDomain}:${
            DockStationConstants.nginxPortNumber
        }`

        return self.domainResolveChecker
            .verifyDomainResolvesToDefaultServerOnHost(url)
            .then(function () {
                return self.dataStore.getHasRootSsl()
            })
            .then(function (hasRootSsl) {
                if (
                    !force &&
                    hasRootSsl &&
                    self.dataStore.getRootDomain() !== requestedCustomDomain
                ) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'SSL is enabled for root. You can still force change the root domain, but read docs for consequences!'
                    )
                }

                if (force) {
                    return self
                        .forceSsl(false)
                        .then(function () {
                            return self.dataStore.setHasRootSsl(false)
                        })
                        .then(function () {
                            return self.dataStore
                                .getAppsDataStore()
                                .ensureAllAppsSubDomainSslDisabled()
                        })
                }
            })
            .then(function () {
                return self.dataStore
                    .getRegistriesDataStore()
                    .getAllRegistries()
            })
            .then(function (registries) {
                let localRegistry: IRegistryInfo | undefined = undefined

                for (let idx = 0; idx < registries.length; idx++) {
                    const element = registries[idx]
                    if (element.registryType === IRegistryTypes.LOCAL_REG) {
                        localRegistry = element
                    }
                }

                if (localRegistry) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.ILLEGAL_OPERATION,
                        'Delete your self-hosted Docker registry before changing the domain.'
                    )
                }

                return Promise.resolve(true)
            })
            .then(function () {
                return self.dataStore.setCustomDomain(requestedCustomDomain)
            })
            .then(function () {
                Logger.d(
                    'Updating Load Balancer - DockStationManager.changeDockStationRootDomain'
                )
                return self.loadBalancerManager.rePopulateNginxConfigFile(
                    self.dataStore
                )
            })
    }

    resetSelf() {
        const self = this
        Logger.d('DockStation is resetting itself!')
        self.waitUntilRestarted = true
        return new Promise<void>(function (resolve, reject) {
            setTimeout(function () {
                return self.dockerApi.updateService(
                    DockStationConstants.dockstationServiceName,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined
                )
            }, 2000)
        })
    }

    private static dockstationManagerInstance: DockStationManager | undefined

    static get(): DockStationManager {
        if (!DockStationManager.dockstationManagerInstance) {
            DockStationManager.dockstationManagerInstance = new DockStationManager()
        }
        return DockStationManager.dockstationManagerInstance
    }
}

export default DockStationManager
