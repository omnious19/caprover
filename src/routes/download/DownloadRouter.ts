import express = require('express')
import ApiStatusCodes from '../../api/ApiStatusCodes'
import Authenticator from '../../user/Authenticator'
import DockStationConstants from '../../utils/DockStationConstants'
import Utils from '../../utils/Utils'

const router = express.Router()

router.get('/', function (req, res, next) {
    const downloadToken = req.query.downloadToken as string
    const namespace = req.query.namespace as string

    Promise.resolve() //
        .then(function () {
            return Authenticator.getAuthenticator(
                namespace
            ).decodeDownloadToken(downloadToken)
        })
        .then(function (obj) {
            const fileFullPath = `${DockStationConstants.dockstationDownloadsDirectory}/${namespace}/${obj.downloadFileName}`
            res.download(fileFullPath, function () {
                Utils.deleteFileQuietly(fileFullPath)
            })
        })
        .catch(ApiStatusCodes.createCatcher(res))
})

export default router
