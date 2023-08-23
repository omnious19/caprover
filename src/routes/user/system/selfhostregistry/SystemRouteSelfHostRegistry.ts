import express = require('express')
import { v4 as uuid } from 'uuid'
import ApiStatusCodes from '../../../../api/ApiStatusCodes'
import BaseApi from '../../../../api/BaseApi'
import InjectionExtractor from '../../../../injection/InjectionExtractor'
import { IRegistryTypes } from '../../../../models/IRegistryInfo'
import DockStationManager from '../../../../user/system/DockStationManager'
import DockStationConstants from '../../../../utils/DockStationConstants'
import Logger from '../../../../utils/Logger'

const router = express.Router()

// ERRORS if a local already exists in DB
router.post('/enableregistry/', function (req, res, next) {
    const dockstationManager = DockStationManager.get()
    const password = uuid()
    const registryHelper =
        InjectionExtractor.extractUserFromInjected(
            res
        ).user.serviceManager.getRegistryHelper()

    return Promise.resolve()
        .then(function () {
            return DockStationManager.get().getDockerRegistry().enableRegistrySsl()
        })
        .then(function () {
            return dockstationManager
                .getDockerRegistry()
                .ensureDockerRegistryRunningOnThisNode(password)
        })
        .then(function () {
            return registryHelper.getAllRegistries()
        })
        .then(function (allRegs) {
            for (let index = 0; index < allRegs.length; index++) {
                const element = allRegs[index]
                if (element.registryType === IRegistryTypes.LOCAL_REG) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.ILLEGAL_PARAMETER,
                        'There is already a local registry set up!'
                    )
                }
            }
            const user = DockStationConstants.dockstationRegistryUsername
            const domain = dockstationManager
                .getDockerRegistry()
                .getLocalRegistryDomainAndPort()

            return registryHelper.addRegistry(
                user,
                password,
                domain,
                user,
                IRegistryTypes.LOCAL_REG
            )
        })
        .then(function () {
            const msg = 'Local registry is created.'
            Logger.d(msg)
            res.send(new BaseApi(ApiStatusCodes.STATUS_OK, msg))
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

// ERRORS if default push is this
router.post('/disableregistry/', function (req, res, next) {
    const dockstationManager = DockStationManager.get()
    const registryHelper =
        InjectionExtractor.extractUserFromInjected(
            res
        ).user.serviceManager.getRegistryHelper()

    return Promise.resolve()
        .then(function () {
            return registryHelper.getAllRegistries()
        })
        .then(function (regs) {
            let localRegistryId = ''
            for (let idx = 0; idx < regs.length; idx++) {
                const element = regs[idx]
                if (element.registryType === IRegistryTypes.LOCAL_REG) {
                    localRegistryId = element.id
                }
            }

            return registryHelper.deleteRegistry(localRegistryId, true)
        })
        .then(function () {
            return dockstationManager.getDockerRegistry().ensureServiceRemoved()
        })
        .then(function () {
            const msg = 'Local registry is removed.'
            Logger.d(msg)
            res.send(new BaseApi(ApiStatusCodes.STATUS_OK, msg))
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

export default router
