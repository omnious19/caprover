import { Response } from 'express'
import Logger from '../utils/Logger'
import BaseApi from './BaseApi'
import { DockStationError } from './DockStationError'

class ApiStatusCodes {
    static createError(code: number, message: string) {
        return new DockStationError(code, message || 'NONE')
    }

    static createCatcher(res: Response) {
        return function (error: DockStationError | any) {
            if (!error || error.errorStatus !== 404) {
                Logger.e(error)
            }

            if (error && error.dockstationErrorType) {
                res.send(new BaseApi(error.dockstationErrorType, error.apiMessage))
                return
            }

            if (error && error.errorStatus) {
                res.sendStatus(Number(error.errorStatus))
                return
            }

            res.sendStatus(500)
        }
    }

    static readonly STATUS_ERROR_GENERIC = 1000
    static readonly STATUS_OK = 100
    static readonly STATUS_OK_DEPLOY_STARTED = 101
    static readonly STATUS_OK_PARTIALLY = 102
    static readonly STATUS_ERROR_DOCKSTATION_NOT_INITIALIZED = 1001
    static readonly STATUS_ERROR_USER_NOT_INITIALIZED = 1101
    static readonly STATUS_ERROR_NOT_AUTHORIZED = 1102
    static readonly STATUS_ERROR_ALREADY_EXIST = 1103
    static readonly STATUS_ERROR_BAD_NAME = 1104
    static readonly STATUS_WRONG_PASSWORD = 1105
    static readonly STATUS_AUTH_TOKEN_INVALID = 1106
    static readonly VERIFICATION_FAILED = 1107
    static readonly ILLEGAL_OPERATION = 1108
    static readonly BUILD_ERROR = 1109
    static readonly ILLEGAL_PARAMETER = 1110
    static readonly NOT_FOUND = 1111
    static readonly AUTHENTICATION_FAILED = 1112
    static readonly STATUS_PASSWORD_BACK_OFF = 1113
    static readonly STATUS_ERROR_OTP_REQUIRED = 1114
    static readonly STATUS_ERROR_PRO_API_KEY_INVALIDATED = 1115
}

export default ApiStatusCodes
