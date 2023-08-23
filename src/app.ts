import express = require('express')
import path = require('path')
import favicon = require('serve-favicon')
import loggerMorgan = require('morgan')
import cookieParser = require('cookie-parser')
import bodyParser = require('body-parser')
import httpProxyImport = require('http-proxy')

import * as http from 'http'
import ApiStatusCodes from './api/ApiStatusCodes'
import BaseApi from './api/BaseApi'
import InjectionExtractor from './injection/InjectionExtractor'
import * as Injector from './injection/Injector'
import DownloadRouter from './routes/download/DownloadRouter'
import LoginRouter from './routes/login/LoginRouter'
import UserRouter from './routes/user/UserRouter'
import DockStationManager from './user/system/DockStationManager'
import DockStationConstants from './utils/DockStationConstants'
import Logger from './utils/Logger'
import Utils from './utils/Utils'

// import { NextFunction, Request, Response } from 'express'

const httpProxy = httpProxyImport.createProxyServer({})

const app = express()

app.set('views', path.join(__dirname, '../views'))
app.set('view engine', 'ejs')

app.use(favicon(path.join(__dirname, '../public', 'favicon.ico')))
app.use(
    loggerMorgan('dev', {
        skip: function (req, res) {
            return (
                req.originalUrl === DockStationConstants.healthCheckEndPoint ||
                req.originalUrl.startsWith(
                    DockStationConstants.netDataRelativePath + '/'
                )
            )
        },
    })
)
app.use(bodyParser.json())
app.use(
    bodyParser.urlencoded({
        extended: false,
    })
)
app.use(cookieParser())

if (DockStationConstants.isDebug) {
    app.use('*', function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader(
            'Access-Control-Allow-Headers',
            `${DockStationConstants.headerNamespace},${DockStationConstants.headerAuth},Content-Type`
        )

        if (req.method === 'OPTIONS') {
            res.sendStatus(200)
        } else {
            next()
        }
    })

    app.use('/force-exit', function (req, res, next) {
        res.send('Okay... I will exit in a second...')

        setTimeout(function () {
            process.exit(0)
        }, 500)
    })
}

app.use(Injector.injectGlobal())

app.use(function (req, res, next) {
    if (InjectionExtractor.extractGlobalsFromInjected(res).forceSsl) {
        const isRequestSsl =
            req.secure || req.get('X-Forwarded-Proto') === 'https'

        if (!isRequestSsl) {
            const newUrl = `https://${req.get('host')}${req.originalUrl}`
            res.redirect(302, newUrl)
            return
        }
    }

    next()
})

app.use(express.static(path.join(__dirname, '../dist-frontend')))

app.use(express.static(path.join(__dirname, 'public')))

app.use(DockStationConstants.healthCheckEndPoint, function (req, res, next) {
    res.send(DockStationManager.get().getHealthCheckUuid())
})

//  ************  Beginning of reverse proxy 3rd party services  ****************************************

app.use(DockStationConstants.netDataRelativePath, function (req, res, next) {
    if (
        req.originalUrl.indexOf(DockStationConstants.netDataRelativePath + '/') !==
        0
    ) {
        const isRequestSsl =
            req.secure || req.get('X-Forwarded-Proto') === 'https'

        const newUrl =
            (isRequestSsl ? 'https://' : 'http://') +
            req.get('host') +
            DockStationConstants.netDataRelativePath +
            '/'
        res.redirect(302, newUrl)
        return
    }

    next()
})

app.use(
    DockStationConstants.netDataRelativePath,
    Injector.injectUserUsingCookieDataOnly()
)

app.use(DockStationConstants.netDataRelativePath, function (req, res, next) {
    if (!InjectionExtractor.extractUserFromInjected(res)) {
        Logger.e('User not logged in for NetData')
        res.sendStatus(500)
    } else {
        next()
    }
})

httpProxy.on('error', function (err, req, resOriginal: http.ServerResponse) {
    if (err) {
        Logger.e(err)
    }

    resOriginal.writeHead(500, {
        'Content-Type': 'text/plain',
    })

    if (
        (err + '').indexOf('getaddrinfo ENOTFOUND dockstation-netdata-container') >=
        0
    ) {
        resOriginal.end(
            `Something went wrong... err:  \n NetData is not running! Are you sure you have started it?`
        )
    } else {
        resOriginal.end(`Something went wrong... err: \n ${err ? err : 'NULL'}`)
    }
})

app.use(DockStationConstants.netDataRelativePath, function (req, res, next) {
    if (Utils.isNotGetRequest(req)) {
        res.writeHead(401, {
            'Content-Type': 'text/plain',
        })
        res.send('Demo mode is for viewing only')
        return
    }

    httpProxy.web(req, res, {
        target: `http://${DockStationConstants.netDataContainerName}:19999`,
    })
})

//  ************  End of reverse proxy 3rd party services  ****************************************

//  *********************  Beginning of API End Points  *******************************************

const API_PREFIX = '/api/'

app.use(API_PREFIX + ':apiVersionFromRequest/', function (req, res, next) {
    if (req.params.apiVersionFromRequest !== DockStationConstants.apiVersion) {
        res.send(
            new BaseApi(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                `This dockstation instance only accepts API ${DockStationConstants.apiVersion}`
            )
        )
        return
    }

    if (!InjectionExtractor.extractGlobalsFromInjected(res).initialized) {
        const response = new BaseApi(
            ApiStatusCodes.STATUS_ERROR_DOCKSTATION_NOT_INITIALIZED,
            'DockStation is not ready yet...'
        )
        res.send(response)
        return
    }

    next()
})

// unsecured end points:
app.use(API_PREFIX + DockStationConstants.apiVersion + '/login/', LoginRouter)
app.use(
    API_PREFIX + DockStationConstants.apiVersion + '/downloads/',
    DownloadRouter
)

// secured end points
app.use(API_PREFIX + DockStationConstants.apiVersion + '/user/', UserRouter)

//  *********************  End of API End Points  *******************************************

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    res.locals.err = new Error('Not Found')
    res.locals.err.errorStatus = 404
    next(res.locals.err)
})

// error handler
app.use(function (err, req, res, next) {
    Promise.reject(err).catch(ApiStatusCodes.createCatcher(res))
} as express.ErrorRequestHandler)

export default app

export function initializeDockStationWithDelay() {
    // Initializing with delay helps with debugging. Usually, docker didn't see the DOCKSTATION service
    // if this was done without a delay
    setTimeout(function () {
        DockStationManager.get().initialize()
    }, 1500)
}
