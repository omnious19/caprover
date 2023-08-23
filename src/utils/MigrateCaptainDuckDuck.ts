import * as fs from 'fs-extra'
import * as path from 'path'
import DataStore from '../datastore/DataStore'
import DockerApi from '../docker/DockerApi'
import { IRegistryTypes } from '../models/IRegistryInfo'
import Authenticator from '../user/Authenticator'
import DockStationConstants from './DockStationConstants'
import Logger from './Logger'

export default class MigrateDockStationDuckDuck {
    private oldFilePath: string
    private oldData: any
    constructor(
        private dataStore: DataStore,
        private authenticator: Authenticator
    ) {
        this.oldFilePath = path.join(
            DockStationConstants.dockstationDataDirectory,
            'config.conf'
        )
    }
    migrateIfNeeded() {
        // TODO ensure this is all happening
        // DockStation Boots-up
        // - Check if old conf file is available
        // - if so, then read json file and convert the old data into new data and save the data
        // - one all promises are done.
        // - Remove the old conf file and if it fails just hard crash.
        //
        // Migration limitations
        // Repos push webhook changes, need to be re-set in your git repo
        // Remote registries will need to be re-entered
        // Revert to version does not work for images built before the migration, e.g. failed deploys and images pushed to registry do not work

        const self = this
        const oldFilePath = self.oldFilePath
        if (!fs.pathExistsSync(oldFilePath)) {
            Logger.d('Migration not needed, skipping.')
            return Promise.resolve(false)
        }

        return this.performMigration().then(function () {
            return true
        })
    }

    performMigration() {
        Logger.d('Migration starting now...')

        const self = this
        const oldFilePath = self.oldFilePath

        const dataStore = this.dataStore

        return Promise.resolve()
            .then(function (data) {
                return fs.readJson(
                    path.join(
                        DockStationConstants.dockstationDataDirectory,
                        'config.conf'
                    )
                )
            })
            .then(function (dataRetrieved) {
                self.oldData = dataRetrieved
            })
            .then(function () {
                Logger.d('Migrating basic configs...')
                const oldData = self.oldData

                const promises: Promise<void>[] = []

                if (oldData.customDomain) {
                    promises.push(
                        dataStore.setCustomDomain(oldData.customDomain)
                    )
                }

                if (oldData.hashedPassword) {
                    promises.push(
                        dataStore.setHashedPassword(oldData.hashedPassword)
                    )
                }

                if (oldData.emailAddress) {
                    promises.push(
                        dataStore.setUserEmailAddress(oldData.emailAddress)
                    )
                }

                if (oldData.hasRootSsl) {
                    promises.push(dataStore.setHasRootSsl(!!oldData.hasRootSsl))
                }

                if (oldData.forceRootSsl) {
                    promises.push(dataStore.setForceSsl(!!oldData.forceRootSsl))
                }

                if (oldData.hasRegistrySsl) {
                    promises.push(
                        dataStore.setHasRegistrySsl(!!oldData.hasRegistrySsl)
                    )
                }

                if (oldData.NGINX_BASE_CONFIG || oldData.NGINX_DOCKSTATION_CONFIG) {
                    promises.push(
                        dataStore.setNginxConfig(
                            oldData.NGINX_BASE_CONFIG,
                            oldData.NGINX_DOCKSTATION_CONFIG
                        )
                    )
                }

                if (oldData.netDataInfo && oldData.netDataInfo.isEnabled) {
                    promises.push(dataStore.setNetDataInfo(oldData.netDataInfo))
                }

                return Promise.all(promises)
            })
            .then(function () {
                const oldData = self.oldData
                if (!oldData.dockstationRegistryAuthSecretVer) {
                    return Promise.resolve()
                }

                const authObj = JSON.parse(
                    fs
                        .readFileSync(
                            `/run/secrets/dockstation-reg-auth${Number(
                                oldData.dockstationRegistryAuthSecretVer
                            )}`
                        )
                        .toString()
                )

                const registriesDataStore = dataStore.getRegistriesDataStore()

                if (
                    (authObj.serveraddress as string).endsWith(
                        `${oldData.customDomain}:${DockStationConstants.configs.registrySubDomainPort}` as string
                    )
                ) {
                    // local
                    return registriesDataStore
                        .addRegistryToDb(
                            authObj.username,
                            authObj.password,
                            authObj.serveraddress,
                            authObj.username,
                            IRegistryTypes.LOCAL_REG
                        )
                        .then(function (idOfNewReg) {
                            return registriesDataStore.setDefaultPushRegistryId(
                                idOfNewReg
                            )
                        })
                } else {
                    // remote
                    return registriesDataStore
                        .addRegistryToDb(
                            authObj.username,
                            authObj.password,
                            authObj.serveraddress,
                            authObj.username,
                            IRegistryTypes.REMOTE_REG
                        )
                        .then(function (idOfNewReg) {
                            return registriesDataStore.setDefaultPushRegistryId(
                                idOfNewReg
                            )
                        })
                }
            })
            .then(function () {
                return DockerApi.get().getAllServices()
            })
            .then(function (dockerServices) {
                const oldAppDefinitions = self.oldData.appDefinitions
                if (!oldAppDefinitions) return Promise.resolve()

                function findCurrentlyInUseImageForApp(
                    appNameToSearch: string
                ) {
                    for (let i = 0; i < dockerServices.length; i++) {
                        const element = dockerServices[i]
                        if (
                            element.Spec.Name ===
                            'srv-dockstation--' + appNameToSearch
                        ) {
                            return element.Spec.TaskTemplate.ContainerSpec.Image
                        }
                    }

                    return ''
                }

                const promises: Promise<void>[] = []

                Object.keys(oldAppDefinitions).forEach((appName) => {
                    const app = JSON.parse(
                        JSON.stringify(oldAppDefinitions[appName])
                    )

                    const appStore = dataStore.getAppsDataStore()

                    const p = Promise.resolve() //
                        .then(function () {
                            return appStore.registerAppDefinition(
                                appName,
                                !!app.hasPersistentData
                            )
                        })
                        .then(function () {
                            for (
                                let index = 0;
                                index < app.volumes.length;
                                index++
                            ) {
                                const element = app.volumes[index]
                                element.type = undefined
                            }

                            const repoInfo = {
                                user: '',
                                password: '',
                                sshKey: '',
                                branch: '',
                                repo: '',
                            }

                            if (
                                app.appPushWebhook &&
                                app.appPushWebhook.repoInfo
                            ) {
                                const extracted = JSON.parse(
                                    Buffer.from(
                                        app.appPushWebhook.repoInfo.split(
                                            '.'
                                        )[1],
                                        'base64'
                                    ).toString()
                                ).data

                                repoInfo.user = extracted.user
                                repoInfo.password = extracted.password
                                repoInfo.branch = extracted.branch
                                repoInfo.repo = extracted.repo
                            }

                            return Promise.resolve()
                                .then(function () {
                                    const customDomains = app.customDomain || []
                                    const hasDefaultSubDomainSsl =
                                        !!app.hasDefaultSubDomainSsl
                                    return appStore.addCustomDomainForAppForMigration(
                                        appName,
                                        hasDefaultSubDomainSsl,
                                        customDomains
                                    )
                                })
                                .then(function () {
                                    const oldVers: any[] = app.versions || []
                                    const newVers: IAppVersion[] = []
                                    const newVersOnlyDeployVersion: IAppVersion[] =
                                        []
                                    const deployedVersion = Number(
                                        app.deployedVersion
                                    )

                                    oldVers.forEach((element) => {
                                        const thisVersion = Number(
                                            element.version
                                        )

                                        let deployedImageName = `img-dockstation--${appName}:${thisVersion}`

                                        if (thisVersion === deployedVersion) {
                                            deployedImageName =
                                                findCurrentlyInUseImageForApp(
                                                    appName
                                                )

                                            // Only add the currently deployed version. Revert won't work for other versions as
                                            // it's impossible to guess their image name correct 100% due to the fact that
                                            // we don't know if they were pushed to the registry or not
                                            newVersOnlyDeployVersion.push({
                                                timeStamp:
                                                    element.timeStamp || '',
                                                version: thisVersion,
                                                gitHash: element.gitHash,
                                                deployedImageName,
                                            })
                                        }

                                        newVers.push({
                                            timeStamp: element.timeStamp || '',
                                            version: thisVersion,
                                            gitHash: element.gitHash,
                                            deployedImageName,
                                        })
                                    })

                                    const deployedVersionFound =
                                        newVersOnlyDeployVersion.length === 1
                                    if (!deployedVersionFound) {
                                        Logger.d(
                                            '********* WARNING!! *********'
                                        )
                                        Logger.d(
                                            `** Not able to find the deployed image for ${appName}. This app might misbehave!! **`
                                        )
                                    }

                                    return appStore.setVersionsForMigration(
                                        appName,
                                        deployedVersionFound
                                            ? newVersOnlyDeployVersion
                                            : newVers,
                                        deployedVersion
                                    )
                                })
                                .then(function () {
                                    return appStore.updateAppDefinitionInDb(
                                        appName,
                                        '',
                                        Number(app.instanceCount),
                                        DockStationConstants.defaultDockStationDefinitionPath,
                                        app.envVars || [],
                                        app.volumes || [],
                                        [],
                                        app.nodeId || '',
                                        !!app.notExposeAsWebApp,
                                        80,
                                        undefined,
                                        !!app.forceSsl,
                                        app.ports || [],
                                        repoInfo,
                                        self.authenticator,
                                        app.customNginxConfig,
                                        '',
                                        app.preDeployFunction,
                                        '',
                                        false,
                                        {
                                            enabled: false,
                                        }
                                    )
                                })
                        })
                    promises.push(p)
                })

                return Promise.all(promises).then(function () {
                    //
                })
            })
            .then(function () {
                Logger.d(
                    'Old data migrated to new format, deleting the old format...'
                )
                fs.remove(oldFilePath)
            })
            .then(function () {
                Logger.d('Migration successfully done!')
                return Promise.resolve()
            })
    }
}
