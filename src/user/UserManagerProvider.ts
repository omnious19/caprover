import ApiStatusCodes from '../api/ApiStatusCodes'
import DockStationConstants from '../utils/DockStationConstants'
import { UserManager } from './UserManager'

const cache: IHashMapGeneric<UserManager> = {}
export class UserManagerProvider {
    static get(namespace: string) {
        namespace = `${namespace || ''}`.trim()
        if (!namespace) {
            throw new Error('NameSpace is empty')
        }

        if (namespace !== DockStationConstants.rootNameSpace) {
            throw ApiStatusCodes.createError(
                ApiStatusCodes.STATUS_ERROR_GENERIC,
                'Namespace unknown'
            )
        }

        if (!cache[namespace]) {
            cache[namespace] = new UserManager(namespace)
        }

        return cache[namespace]
    }
}
