/*
                              +---------------------------------+
+------------------+          |                                 |
|------------------|          |      Assign the final Image     |                +--------------------+
||                ||          |        (library/mysql           +----------------+   Retag and push   +<-----------+
||    Update      |-----------+             or                  |                |     IF NEEDED      |            |
||DockStation Service ||          |  repo.com:996/dockstation/myimage)  |                +--------------------+            |
||                ||          |                                 |                                                  |
|------------------|          |     as new ver's image          +-----------+                                      +
+------------------+          |                                 |           |                                    CREATE
                              +---------------------------------+           |                             img-dockstation--appname:5
                              |                                 |           |
                              |    Set the Deployed Version     |           +-------------+                         ^
                              +---------------------------------+                         |                         |
                                                                                          |                         |
                                                                                          |                         |
                                                                                          |                         |
                                                          +-----------------------+       |                         |
                                                          |                       |       |                         |
                                                          |      Docker ImageName +-------+                         |
                                                          |                       |                                 |
                                                          +-----------------------+                                 |
       +-------------------+                              |                       |                                 |
       |                   |                              |    dockstation-definition +-------------+                   |
       |                   |                              |         content       |             |                   |
       |   ServiceManager  +----> CreateNewVersion +----> +-----------------------+             |                   |
       |                   |                              |                       |             ^                   |
       |                   |                              |         Uploaded Tar  +-----------------> ImageMaker.   +
       +-------------------+                              |                       |             ^       createImage(appName,Ver,Data)
                                                          +-----------------------+             |
                                                          |                       |             |
                                                          |             GIT Repo  +-------------+
                                                          |                       |
                                                          +-----------------------+

*/

import fs = require('fs-extra')
import tar = require('tar')
import path = require('path')
import ApiStatusCodes from '../api/ApiStatusCodes'
import DockerApi from '../docker/DockerApi'
import { IBuiltImage } from '../models/IBuiltImage'
import { AnyError } from '../models/OtherTypes'
import DockStationConstants from '../utils/DockStationConstants'
import GitHelper from '../utils/GitHelper'
import BuildLog from './BuildLog'
import DockerRegistryHelper from './DockerRegistryHelper'
import TemplateHelper from './TemplateHelper'

const RAW_SOURCE_DIRECTORY = 'source_files'
const TAR_FILE_NAME_READY_FOR_DOCKER = 'image.tar'
const DOCKER_FILE = 'Dockerfile'

export class BuildLogsManager {
    private buildLogs: IHashMapGeneric<BuildLog>

    constructor() {
        this.buildLogs = {}
    }

    getAppBuildLogs(appName: string) {
        const self = this

        self.buildLogs[appName] =
            self.buildLogs[appName] ||
            new BuildLog(DockStationConstants.configs.buildLogSize)

        return self.buildLogs[appName]
    }
}

export default class ImageMaker {
    constructor(
        private dockerRegistryHelper: DockerRegistryHelper,
        private dockerApi: DockerApi,
        private namespace: string,
        private buildLogsManager: BuildLogsManager
    ) {
        //
    }

    private getDirectoryForRawSource(appName: string, version: number) {
        return `${DockStationConstants.dockstationRawSourceDirectoryBase}/${appName}/${version}`
    }

    /**
     * Creates image if necessary, or just simply passes the image name
     */
    ensureImage(
        imageSource: IImageSource,
        appName: string,
        dockstationDefinitionRelativeFilePath: string,
        appVersion: number,
        envVars: IAppEnvVar[]
    ): Promise<IBuiltImage> {
        const self = this

        const logs = self.buildLogsManager.getAppBuildLogs(appName)

        logs.clear()
        logs.log(`------------------------- ${new Date()}`)
        logs.log(`Build started for ${appName}`)

        let gitHash = ''

        const baseDir = self.getDirectoryForRawSource(appName, appVersion)
        const rawDir = `${baseDir}/${RAW_SOURCE_DIRECTORY}`
        const tarFilePath = `${baseDir}/${TAR_FILE_NAME_READY_FOR_DOCKER}`

        const baseImageNameWithoutVerAndReg = `img-${this.namespace}-${
            appName // img-dockstation-myapp
        }`
        let fullImageName = '' // repo.domain.com:998/username/reponame:8

        return Promise.resolve() //
            .then(function () {
                return self.extractContentIntoDestDirectory(
                    imageSource,
                    rawDir,
                    dockstationDefinitionRelativeFilePath
                )
            })
            .then(function (gitHashFromImageSource) {
                gitHash = gitHashFromImageSource

                const includesGitCommitEnvVar = envVars.find(
                    (envVar) => envVar.key === DockStationConstants.gitShaEnvVarKey
                )

                if (gitHash && !includesGitCommitEnvVar) {
                    envVars.push({
                        key: DockStationConstants.gitShaEnvVarKey,
                        value: gitHash,
                    })
                }

                // some users convert the directory into TAR instead of converting the content into TAR.
                // we go one level deep and try to find the right directory.
                // Also, they may have no dockstation-definition file, in that case, fall back to Dockerfile if exists.
                return self.getAbsolutePathOfDockStationDefinition(
                    rawDir,
                    dockstationDefinitionRelativeFilePath
                )
            })
            .then(function (dockstationDefinitionAbsolutePath) {
                return self
                    .getDockStationDefinition(dockstationDefinitionAbsolutePath)
                    .then(function (dockstationDefinition) {
                        if (dockstationDefinition.imageName) {
                            logs.log(
                                `An explicit image name was provided (${dockstationDefinition.imageName}). Therefore, no build process is needed.`
                            )

                            logs.log(
                                `Pulling this image: ${dockstationDefinition.imageName} This process might take a few minutes.`
                            )

                            const providedImageName =
                                dockstationDefinition.imageName + ''

                            return Promise.resolve() //
                                .then(function () {
                                    return self.dockerRegistryHelper.getDockerAuthObjectForImageName(
                                        providedImageName
                                    )
                                })
                                .then(function (authObj) {
                                    return self.dockerApi.pullImage(
                                        providedImageName,
                                        authObj
                                    )
                                })
                                .then(function () {
                                    return providedImageName
                                })
                        }

                        return self.getBuildPushAndReturnImageName(
                            dockstationDefinition,
                            path.dirname(dockstationDefinitionAbsolutePath),
                            tarFilePath,
                            baseImageNameWithoutVerAndReg,
                            appName,
                            appVersion,
                            envVars
                        )
                    })
            })
            .then(function (ret) {
                fullImageName = ret
            })
            .then(function () {
                return fs.remove(baseDir)
            })
            .then(function () {
                if (imageSource.uploadedTarPathSource) {
                    return fs.remove(
                        imageSource.uploadedTarPathSource.uploadedTarPath
                    )
                }
            })
            .catch(function (err) {
                return fs
                    .remove(baseDir)
                    .then(function () {
                        throw err
                    })
                    .catch(function () {
                        return Promise.reject(err)
                    })
            })
            .catch(function (err) {
                if (imageSource.uploadedTarPathSource) {
                    return fs
                        .remove(
                            imageSource.uploadedTarPathSource.uploadedTarPath
                        )
                        .then(function () {
                            throw err
                        })
                        .catch(function () {
                            return Promise.reject(err)
                        })
                }
                return Promise.reject(err)
            })
            .then(function () {
                logs.log(`Build has finished successfully!`)
                return {
                    imageName: fullImageName,
                    gitHash: gitHash,
                }
            })
            .catch(function (error) {
                logs.log(`Build has failed!`)
                return Promise.reject(error)
            })
    }

    private getBuildPushAndReturnImageName(
        dockstationDefinition: IDockStationDefinition,
        correctedDirProvided: string,
        tarFilePath: string,
        baseImageNameWithoutVersionAndReg: string,
        appName: string,
        appVersion: number,
        envVars: IAppEnvVar[]
    ) {
        const self = this
        return Promise.resolve() //
            .then(function () {
                return self
                    .convertDockStationDefinitionToDockerfile(
                        dockstationDefinition,
                        correctedDirProvided
                    )
                    .then(function () {
                        return self.convertContentOfDirectoryIntoTar(
                            correctedDirProvided,
                            tarFilePath
                        )
                    })
                    .then(function () {
                        return self.dockerRegistryHelper.createDockerRegistryConfig()
                    })
                    .then(function (registryConfig) {
                        return self.dockerApi
                            .buildImageFromDockerFile(
                                baseImageNameWithoutVersionAndReg,
                                appVersion,
                                tarFilePath,
                                self.buildLogsManager.getAppBuildLogs(appName),
                                envVars,
                                registryConfig
                            )
                            .catch(function (error: AnyError) {
                                throw ApiStatusCodes.createError(
                                    ApiStatusCodes.BUILD_ERROR,
                                    `${error}`.trim()
                                )
                            })
                    })
                    .then(function () {
                        return self.dockerRegistryHelper.retagAndPushIfDefaultPushExist(
                            baseImageNameWithoutVersionAndReg,
                            appVersion,
                            self.buildLogsManager.getAppBuildLogs(appName)
                        )
                    })
            })
    }

    /**
     * Extracts the content of IImageSource into destDirectory and returns a promise that resolvea
     * to git hash that was provided in IImageSource
     *
     * @param source        the image source
     * @param destDirectory the path to directory where we want to have all our contents
     */
    private extractContentIntoDestDirectory(
        source: IImageSource,
        destDirectory: string,
        dockstationDefinitionRelativeFilePath: string
    ) {
        return Promise.resolve() //
            .then(function () {
                return fs.ensureDir(destDirectory)
            })
            .then(function () {
                // If uploadedTarPath then extract into a directory
                //
                // If Repo then download.
                //
                // If dockstationDefinitionContent then create a directory and output to a directory
                //
                // Else THROW ERROR

                const srcTar = source.uploadedTarPathSource
                if (srcTar) {
                    // extract file to to destDirectory
                    return tar
                        .extract({
                            file: srcTar.uploadedTarPath,
                            cwd: destDirectory,
                        })
                        .then(function () {
                            return srcTar.gitHash
                        })
                }

                const srcRepo = source.repoInfoSource
                if (srcRepo) {
                    return GitHelper.clone(
                        srcRepo.user,
                        srcRepo.password,
                        srcRepo.sshKey || '',
                        srcRepo.repo,
                        srcRepo.branch,
                        destDirectory
                    ) //
                        .then(function () {
                            return GitHelper.getLastHash(destDirectory)
                        })
                }

                const dockstationDefinitionContentSource =
                    source.dockstationDefinitionContentSource
                if (dockstationDefinitionContentSource) {
                    return fs
                        .outputFile(
                            path.join(
                                destDirectory,
                                dockstationDefinitionRelativeFilePath
                            ),
                            dockstationDefinitionContentSource.dockstationDefinitionContent
                        )
                        .then(function () {
                            return dockstationDefinitionContentSource.gitHash
                        })
                }
                // we should never get here!
                throw new Error('Source is unknown!')
            })
    }

    private getAllChildrenOfDirectory(directory: string) {
        return Promise.resolve() //
            .then(function () {
                return new Promise<string[]>(function (resolve, reject) {
                    fs.readdir(directory, function (err, files) {
                        if (err) {
                            reject(err)
                            return
                        }
                        resolve(files)
                    })
                })
            })
    }

    private getDockStationDefinition(dockstationDefinitionAbsolutePath: string) {
        return Promise.resolve() //
            .then(function () {
                return fs.readJson(dockstationDefinitionAbsolutePath)
            })
            .then(function (data: IDockStationDefinition) {
                if (!data) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'DockStation Definition File is empty!'
                    )
                }

                if (!data.schemaVersion) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'DockStation Definition version is empty!'
                    )
                }

                if (data.schemaVersion !== 2) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'DockStation Definition version is not supported! Read migration guides to schemaVersion 2'
                    )
                }

                const hasDockerfileLines =
                    data.dockerfileLines && data.dockerfileLines.length > 0

                const numberOfProperties =
                    (data.templateId ? 1 : 0) +
                    (data.imageName ? 1 : 0) +
                    (data.dockerfilePath ? 1 : 0) +
                    (hasDockerfileLines ? 1 : 0)

                if (numberOfProperties !== 1) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'One, and only one, of these properties should be present in dockstation-definition: templateId, imageName, dockerfilePath, or, dockerfileLines'
                    )
                }

                return data
            })
    }

    private convertDockStationDefinitionToDockerfile(
        dockstationDefinition: IDockStationDefinition,
        directoryWithDockStationDefinition: string
    ) {
        return Promise.resolve() //
            .then(function () {
                const data = dockstationDefinition
                if (data.templateId) {
                    return TemplateHelper.get().getDockerfileContentFromTemplateTag(
                        data.templateId
                    )
                } else if (data.dockerfileLines) {
                    return data.dockerfileLines.join('\n')
                } else if (data.dockerfilePath) {
                    if (data.dockerfilePath.startsWith('..')) {
                        throw ApiStatusCodes.createError(
                            ApiStatusCodes.STATUS_ERROR_GENERIC,
                            'dockerfilePath should not refer to parent directory!'
                        )
                    }

                    return fs
                        .readFileSync(
                            path.join(
                                directoryWithDockStationDefinition,
                                data.dockerfilePath
                            )
                        )
                        .toString()
                } else if (data.imageName) {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'ImageName cannot be rebuilt'
                    )
                } else {
                    throw ApiStatusCodes.createError(
                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                        'dockerfileLines, dockerFilePath, templateId or imageName must be present. Both should not be present at the same time'
                    )
                }
            })
            .then(function (dockerfileContent) {
                return fs.outputFile(
                    `${directoryWithDockStationDefinition}/${DOCKER_FILE}`,
                    dockerfileContent
                )
            })
    }

    private getAbsolutePathOfDockStationDefinition(
        originalDirectory: string,
        dockstationDefinitionRelativeFilePath: string
    ) {
        const self = this

        function isDockStationDefinitionOrDockerfileInDir(dir: string) {
            const dockstationDefinitionPossiblePath = path.join(
                dir,
                dockstationDefinitionRelativeFilePath
            )
            return Promise.resolve()
                .then(function () {
                    return fs.pathExists(dockstationDefinitionPossiblePath)
                })
                .then(function (exits) {
                    return (
                        !!exits &&
                        fs.statSync(dockstationDefinitionPossiblePath).isFile()
                    )
                })
                .then(function (dockstationDefinitionExists) {
                    if (dockstationDefinitionExists) return true

                    // Falling back to plain Dockerfile, check if it exists!

                    const dockerfilePossiblePath = path.join(dir, DOCKER_FILE)
                    return fs
                        .pathExists(dockerfilePossiblePath)
                        .then(function (exits) {
                            return (
                                !!exits &&
                                fs.statSync(dockerfilePossiblePath).isFile()
                            )
                        })
                        .then(function (dockerfileExists) {
                            if (!dockerfileExists) return false

                            const dockstationDefinitionDefault: IDockStationDefinition =
                                {
                                    schemaVersion: 2,
                                    dockerfilePath: `./${DOCKER_FILE}`,
                                }

                            return fs
                                .outputFile(
                                    dockstationDefinitionPossiblePath,
                                    JSON.stringify(dockstationDefinitionDefault)
                                )
                                .then(function () {
                                    return true
                                })
                        })
                })
        }

        return Promise.resolve()
            .then(function () {
                // make sure if you need to go to child directory
                return isDockStationDefinitionOrDockerfileInDir(originalDirectory)
            })
            .then(function (exists) {
                if (exists) return originalDirectory

                // check if there is only one child
                // check if it's a directory
                // check if dockstation definition exists in it
                // if so, return the child directory
                return self
                    .getAllChildrenOfDirectory(originalDirectory)
                    .then(function (files) {
                        files = files || []
                        if (files.length === 1) {
                            return isDockStationDefinitionOrDockerfileInDir(
                                path.join(originalDirectory, files[0])
                            ) //
                                .then(function (existsInChild) {
                                    if (existsInChild)
                                        return path.join(
                                            originalDirectory,
                                            files[0]
                                        )

                                    throw ApiStatusCodes.createError(
                                        ApiStatusCodes.STATUS_ERROR_GENERIC,
                                        'DockStation Definition file does not exist!'
                                    )
                                })
                        }

                        throw ApiStatusCodes.createError(
                            ApiStatusCodes.STATUS_ERROR_GENERIC,
                            'DockStation Definition file does not exist!'
                        )
                    })
            })
            .then(function (correctedRootDirectory) {
                return path.join(
                    correctedRootDirectory,
                    dockstationDefinitionRelativeFilePath
                )
            })
    }

    private convertContentOfDirectoryIntoTar(
        sourceDirectory: string,
        tarFilePath: string
    ) {
        return Promise.resolve() //
            .then(function () {
                return tar.c(
                    {
                        file: tarFilePath,
                        cwd: sourceDirectory,
                    },
                    ['./']
                )
            })
    }
}
