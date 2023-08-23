interface IImageSource {
    uploadedTarPathSource?: { uploadedTarPath: string; gitHash: string }
    dockstationDefinitionContentSource?: {
        dockstationDefinitionContent: string
        gitHash: string
    }
    repoInfoSource?: RepoInfo
}
