import express = require('express')
import validator from 'validator'
import ApiStatusCodes from '../../../api/ApiStatusCodes'
import BaseApi from '../../../api/BaseApi'
import DockerApi from '../../../docker/DockerApi'
import DockerUtils from '../../../docker/DockerUtils'
import InjectionExtractor from '../../../injection/InjectionExtractor'
import DockStationManager from '../../../user/system/DockStationManager'
import VersionManager from '../../../user/system/VersionManager'
import DockStationConstants from '../../../utils/DockStationConstants'
import Logger from '../../../utils/Logger'
import Utils from '../../../utils/Utils'
import SystemRouteSelfHostRegistry from './selfhostregistry/SystemRouteSelfHostRegistry'

const router = express.Router()

router.use('/selfhostregistry/', SystemRouteSelfHostRegistry)

router.post('/createbackup/', function (req, res, next) {
    const backupManager = DockStationManager.get().getBackupManager()

    Promise.resolve()
        .then(function () {
            return backupManager.createBackup(DockStationManager.get())
        })
        .then(function (backupInfo) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Backup created.'
            )
            baseApi.data = backupInfo
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/changerootdomain/', function (req, res, next) {
    const requestedCustomDomain = Utils.removeHttpHttps(
        (req.body.rootDomain || '').toLowerCase()
    )

    if (
        !requestedCustomDomain ||
        requestedCustomDomain.length < 3 ||
        requestedCustomDomain.indexOf('/') >= 0 ||
        requestedCustomDomain.indexOf(':') >= 0 ||
        requestedCustomDomain.indexOf('%') >= 0 ||
        requestedCustomDomain.indexOf(' ') >= 0 ||
        requestedCustomDomain.indexOf('\\') >= 0
    ) {
        res.send(
            new BaseApi(ApiStatusCodes.STATUS_ERROR_GENERIC, 'Bad domain name.')
        )
        return
    }

    DockStationManager.get()
        .changeDockStationRootDomain(requestedCustomDomain, !!req.body.force)
        .then(function () {
            res.send(
                new BaseApi(ApiStatusCodes.STATUS_OK, 'Root domain changed.')
            )
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/enablessl/', function (req, res, next) {
    const emailAddress = req.body.emailAddress || ''

    if (
        !emailAddress ||
        emailAddress.length < 3 ||
        emailAddress.indexOf('/') >= 0 ||
        emailAddress.indexOf(':') >= 0 ||
        emailAddress.indexOf('%') >= 0 ||
        emailAddress.indexOf(' ') >= 0 ||
        emailAddress.indexOf('\\') >= 0 ||
        !validator.isEmail(emailAddress)
    ) {
        res.send(
            new BaseApi(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                'Bad email address.'
            )
        )
        return
    }

    DockStationManager.get()
        .enableSsl(emailAddress)
        .then(function () {
            // This is necessary as the CLI immediately tries to connect to https://dockstationroot.com
            // Without this delay it'll fail to connect
            Logger.d('Waiting for 7 seconds...')
            return Utils.getDelayedPromise(7000)
        })
        .then(function () {
            res.send(new BaseApi(ApiStatusCodes.STATUS_OK, 'Root SSL Enabled.'))
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/forcessl/', function (req, res, next) {
    const isEnabled = !!req.body.isEnabled

    DockStationManager.get()
        .forceSsl(isEnabled)
        .then(function () {
            res.send(
                new BaseApi(
                    ApiStatusCodes.STATUS_OK,
                    `Non-SSL traffic is now ${
                        isEnabled ? 'rejected.' : 'allowed.'
                    }`
                )
            )
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/info/', function (req, res, next) {
    const dataStore =
        InjectionExtractor.extractUserFromInjected(res).user.dataStore

    return Promise.resolve()
        .then(function () {
            return dataStore.getHasRootSsl()
        })
        .then(function (hasRootSsl) {
            return {
                hasRootSsl: hasRootSsl,
                forceSsl: DockStationManager.get().getForceSslValue(),
                rootDomain: dataStore.hasCustomDomain()
                    ? dataStore.getRootDomain()
                    : '',
                dockstationSubDomain: DockStationConstants.configs.dockstationSubDomain,
            }
        })
        .then(function (data) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'DockStation info retrieved'
            )
            baseApi.data = data
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/loadbalancerinfo/', function (req, res, next) {
    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().getLoadBalanceManager().getInfo()
        })
        .then(function (data) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Load Balancer info retrieved'
            )
            baseApi.data = data
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/versionInfo/', function (req, res, next) {
    return Promise.resolve()
        .then(function () {
            return VersionManager.get().getDockStationImageTags()
        })
        .then(function (data) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Version Info Retrieved'
            )
            baseApi.data = data
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/versionInfo/', function (req, res, next) {
    const latestVersion = req.body.latestVersion
    const registryHelper =
        InjectionExtractor.extractUserFromInjected(
            res
        ).user.serviceManager.getRegistryHelper()

    return Promise.resolve()
        .then(function () {
            return VersionManager.get().updateDockStation(
                latestVersion,
                registryHelper
            )
        })
        .then(function () {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'DockStation update process has started...'
            )
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/netdata/', function (req, res, next) {
    const dataStore =
        InjectionExtractor.extractUserFromInjected(res).user.dataStore

    return Promise.resolve()
        .then(function () {
            return dataStore.getNetDataInfo()
        })
        .then(function (data) {
            data.netDataUrl = `${
                DockStationConstants.configs.dockstationSubDomain
            }.${dataStore.getRootDomain()}${
                DockStationConstants.netDataRelativePath
            }`
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Netdata info retrieved'
            )
            baseApi.data = data
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/netdata/', function (req, res, next) {
    const netDataInfo = req.body.netDataInfo
    netDataInfo.netDataUrl = undefined // Frontend app returns this value, but we really don't wanna save this.
    // root address is subject to change.

    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().updateNetDataInfo(netDataInfo)
        })
        .then(function () {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Netdata info is updated'
            )
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/nginxconfig/', function (req, res, next) {
    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().getNginxConfig()
        })
        .then(function (data) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Nginx config retrieved'
            )
            baseApi.data = data
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/nginxconfig/', function (req, res, next) {
    const baseConfigCustomValue = req.body.baseConfig.customValue
    const dockstationConfigCustomValue = req.body.dockstationConfig.customValue

    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().setNginxConfig(
                baseConfigCustomValue,
                dockstationConfigCustomValue
            )
        })
        .then(function () {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Nginx config is updated'
            )
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.get('/nodes/', function (req, res, next) {
    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().getNodesInfo()
        })
        .then(function (data) {
            const baseApi = new BaseApi(
                ApiStatusCodes.STATUS_OK,
                'Node info retrieved'
            )
            baseApi.data = { nodes: data }
            res.send(baseApi)
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

router.post('/nodes/', function (req, res, next) {
    const MANAGER = 'manager'
    const WORKER = 'worker'
    const registryHelper =
        InjectionExtractor.extractUserFromInjected(
            res
        ).user.serviceManager.getRegistryHelper()

    let isManager: boolean

    if (req.body.nodeType === MANAGER) {
        isManager = true
    } else if (req.body.nodeType === WORKER) {
        isManager = false
    } else {
        res.send(
            new BaseApi(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                'Node type should be either manager or worker'
            )
        )
        return
    }

    const privateKey = req.body.privateKey
    const remoteNodeIpAddress = req.body.remoteNodeIpAddress
    const dockstationIpAddress = req.body.dockstationIpAddress
    const sshPort = parseInt(req.body.sshPort) || 22
    const sshUser = (req.body.sshUser || 'root').trim()

    if (!dockstationIpAddress || !remoteNodeIpAddress || !privateKey) {
        res.send(
            new BaseApi(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                'Private Key, DockStation IP address, remote IP address and remote username should all be present'
            )
        )
        return
    }

    return Promise.resolve()
        .then(function () {
            return registryHelper.getDefaultPushRegistryId()
        })
        .then(function (defaultRegistry) {
            if (!defaultRegistry) {
                throw ApiStatusCodes.createError(
                    ApiStatusCodes.STATUS_ERROR_GENERIC,
                    'There is no default Docker Registry. You need a repository for your images before adding nodes. Read docs.'
                )
            }
        })
        .then(function () {
            return DockerUtils.joinDockerNode(
                DockerApi.get(),
                sshUser,
                sshPort,
                dockstationIpAddress,
                isManager,
                remoteNodeIpAddress,
                privateKey
            )
        })
        .then(function () {
            const msg = 'Docker node is successfully joined.'
            Logger.d(msg)
            res.send(new BaseApi(ApiStatusCodes.STATUS_OK, msg))
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

export default router
