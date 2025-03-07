import { NextFunction, Request, Response } from 'express'
import ApiStatusCodes from '../api/ApiStatusCodes'
import BaseApi from '../api/BaseApi'
import DataStoreProvider from '../datastore/DataStoreProvider'
import DockerApiProvider from '../docker/DockerApi'
import * as UserModel from '../models/InjectionInterfaces'
import { DockStationError } from '../models/OtherTypes'
import Authenticator from '../user/Authenticator'
import ServiceManager from '../user/ServiceManager'
import { UserManagerProvider } from '../user/UserManagerProvider'
import OtpAuthenticator from '../user/pro/OtpAuthenticator'
import DockStationManager from '../user/system/DockStationManager'
import DockStationConstants from '../utils/DockStationConstants'
import Logger from '../utils/Logger'
import InjectionExtractor from './InjectionExtractor'

const dockerApi = DockerApiProvider.get()

/**
 * Global dependency injection module
 */
export function injectGlobal() {
    return function (req: Request, res: Response, next: NextFunction) {
        const locals = res.locals

        locals.namespace =
            req.header(DockStationConstants.headerNamespace) ||
            DockStationConstants.rootNameSpace

        if (locals.namespace !== DockStationConstants.rootNameSpace) {
            throw ApiStatusCodes.createError(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                'Namespace unknown'
            )
        }

        locals.initialized = DockStationManager.get().isInitialized()
        locals.forceSsl = DockStationManager.get().getForceSslValue()
        locals.userManagerForLoginOnly = UserManagerProvider.get(
            locals.namespace
        )

        next()
    }
}

/**
 * User dependency injection module
 */
export function injectUser() {
    return function (req: Request, res: Response, next: NextFunction) {
        if (InjectionExtractor.extractUserFromInjected(res).user) {
            next()
            return // user is already injected by another layer
        }

        const namespace = res.locals.namespace

        Authenticator.getAuthenticator(namespace)
            .decodeAuthToken(req.header(DockStationConstants.headerAuth) || '')
            .then(function (userDecoded) {
                if (userDecoded) {
                    const datastore = DataStoreProvider.getDataStore(namespace)
                    const userManager = UserManagerProvider.get(namespace)

                    const serviceManager = ServiceManager.get(
                        namespace,
                        Authenticator.getAuthenticator(namespace),
                        datastore,
                        dockerApi,
                        DockStationManager.get().getLoadBalanceManager(),
                        userManager.eventLogger,
                        DockStationManager.get().getDomainResolveChecker()
                    )

                    const user: UserModel.UserInjected = {
                        namespace: namespace,
                        dataStore: datastore,
                        serviceManager: serviceManager,
                        otpAuthenticator: new OtpAuthenticator(
                            datastore,
                            userManager.proManager
                        ),
                        initialized: serviceManager.isInited(),
                        userManager: userManager,
                    }
                    res.locals.user = user
                }

                next()
            })
            .catch(function (error: DockStationError) {
                if (error && error.dockstationErrorType) {
                    res.send(
                        new BaseApi(error.dockstationErrorType, error.apiMessage)
                    )
                    return
                }
                Logger.e(error)
                res.locals.user = undefined
                next()
            })
    }
}

/**
 * A pseudo user injection. Only used for build triggers. Can only trigger certain actions.
 */
export function injectUserForBuildTrigger() {
    return function (req: Request, res: Response, next: NextFunction) {
        const locals = res.locals

        const token = req.header(DockStationConstants.headerAppToken) as string
        const namespace = locals.namespace
        const appName = req.params.appName as string

        if (req.header(DockStationConstants.headerAuth)) {
            // Auth header is present, skip user injection for app token
            next()
            return
        }

        if (!token || !namespace || !appName) {
            Logger.e(
                'Trigger app build is called with no token/namespace/appName'
            )
            next()
            return
        }

        const dataStore = DataStoreProvider.getDataStore(namespace)
        let app: IAppDef | undefined = undefined

        Promise.resolve()
            .then(function () {
                return dataStore.getAppsDataStore().getAppDefinition(appName)
            })
            .then(function (appFound) {
                app = appFound

                const tokenMatches =
                    app?.appDeployTokenConfig?.enabled &&
                    app.appDeployTokenConfig.appDeployToken === token

                if (!tokenMatches) {
                    Logger.e('Token mismatch for app build')
                    next()
                    return
                }

                const datastore = DataStoreProvider.getDataStore(namespace)
                const userManager = UserManagerProvider.get(namespace)

                const serviceManager = ServiceManager.get(
                    namespace,
                    Authenticator.getAuthenticator(namespace),
                    datastore,
                    dockerApi,
                    DockStationManager.get().getLoadBalanceManager(),
                    userManager.eventLogger,
                    DockStationManager.get().getDomainResolveChecker()
                )

                const user: UserModel.UserInjected = {
                    namespace: namespace,
                    dataStore: datastore,
                    serviceManager: serviceManager,
                    otpAuthenticator: new OtpAuthenticator(
                        datastore,
                        userManager.proManager
                    ),
                    initialized: serviceManager.isInited(),
                    userManager: userManager,
                }

                res.locals.user = user
                res.locals.app = app
                res.locals.appName = appName

                next()
            })
            .catch(function (error) {
                Logger.e(error)
                res.locals.app = undefined
                next()
            })
    }
}

/**
 * A pseudo user injection. Only used for webhooks. Can only trigger certain actions.
 */
export function injectUserForWebhook() {
    return function (req: Request, res: Response, next: NextFunction) {
        const token = req.query.token as string
        const namespace = req.query.namespace as string
        let app = undefined

        if (!token || !namespace) {
            Logger.e('Trigger build is called with no token/namespace')
            next()
            return
        }

        const dataStore = DataStoreProvider.getDataStore(namespace)

        let decodedInfo: UserModel.IAppWebHookToken

        Authenticator.getAuthenticator(namespace)
            .decodeAppPushWebhookToken(token)
            .then(function (data) {
                decodedInfo = data

                return dataStore
                    .getAppsDataStore()
                    .getAppDefinition(decodedInfo.appName)
            })
            .then(function (appFound) {
                app = appFound

                if (
                    app.appPushWebhook &&
                    app.appPushWebhook.tokenVersion !== decodedInfo.tokenVersion
                ) {
                    throw new Error('Token Info do not match')
                }

                const datastore = DataStoreProvider.getDataStore(namespace)
                const userManager = UserManagerProvider.get(namespace)

                const serviceManager = ServiceManager.get(
                    namespace,
                    Authenticator.getAuthenticator(namespace),
                    datastore,
                    dockerApi,
                    DockStationManager.get().getLoadBalanceManager(),
                    userManager.eventLogger,
                    DockStationManager.get().getDomainResolveChecker()
                )

                const user: UserModel.UserInjected = {
                    namespace: namespace,
                    dataStore: datastore,
                    otpAuthenticator: new OtpAuthenticator(
                        datastore,
                        userManager.proManager
                    ),
                    serviceManager: serviceManager,
                    initialized: serviceManager.isInited(),
                    userManager: userManager,
                }

                res.locals.user = user
                res.locals.app = app
                res.locals.appName = decodedInfo.appName

                next()
            })
            .catch(function (error) {
                Logger.e(error)
                res.locals.app = undefined
                next()
            })
    }
}

/**
 * User dependency injection module. This is a less secure way for user injection. But for reverse proxy services,
 * this is the only way that we can secure the call
 */
export function injectUserUsingCookieDataOnly() {
    return function (req: Request, res: Response, next: NextFunction) {
        Authenticator.getAuthenticator(DockStationConstants.rootNameSpace)
            .decodeAuthTokenFromCookies(
                req.cookies[DockStationConstants.headerCookieAuth]
            )
            .then(function (user) {
                res.locals.user = user

                next()
            })
            .catch(function (error) {
                if (error && error.dockstationErrorType) {
                    res.send(
                        new BaseApi(error.dockstationErrorType, error.apiMessage)
                    )
                    return
                }
                Logger.e(error)
                res.locals.user = undefined
                next()
            })
    }
}
