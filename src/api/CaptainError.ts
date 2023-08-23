export class DockStationError extends Error {
    public dockstationErrorType: number
    public apiMessage: string

    constructor(code: number, msg: string) {
        super(msg)
        this.dockstationErrorType = code
        this.apiMessage = msg
    }
}
