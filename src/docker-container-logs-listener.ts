import Dockerode from 'dockerode'

export type Stream = 'stdout' | 'stderr'

export interface Opts {
    containerId: string
    stream: Stream
    cb: (log: Log) => void
}

export interface Log {
    date: string
    message: string
}

const trippleNull = Buffer.alloc(3) // like me ahahah

export class DockerContainerLogsListener {
    protected containerId: string
    protected stream: Stream
    protected dockerode: Dockerode = new Dockerode
    protected abortController?: AbortController
    protected cb: Opts['cb']

    public constructor({containerId, stream, cb}: Opts) {
        this.containerId = containerId
        this.stream = stream
        this.cb = cb
    }

    public listen(since: Date, abortSignal?: AbortSignal) {
        if (this.abortController) {
            throw new Error('Already listening')
        }

        if (abortSignal?.aborted) {
            return
        }

        abortSignal?.addEventListener('abort', () => this.stop())

        this.connectAndListen(since)
    }

    public stop() {
        this.abortController?.abort()
        delete this.abortController
    }

    protected dispatchLog(log: Log) {
        this.cb(log)
    }

    protected async connectAndListen(since: Date) {

        this.abortController = new AbortController
        const abortSignal = this.abortController.signal

        //this.logger?.debug('Start to listen container logs')

        let sstream
        let lastLogAt = since

        try {
            sstream = await this.dockerode.getContainer(this.containerId).logs({
                timestamps: true,
                stderr: this.stream === 'stderr',
                stdout: this.stream === 'stdout',
                since: since.getTime() / 1000,
                abortSignal: abortSignal,
                follow: true
            })
        } catch (e) {
            if (abortSignal.aborted) {
                //this.logger?.debug('Aborting listen of container logs')
                return
            }

            //this.logger?.warning('Unexpected logs stream error', {e})

            this.abortController.abort()
            this.connectAndListen(new Date(new Date(lastLogAt).getTime() + 1))

            return
        }

        let outTmpLogs: any[] = []

        sstream.on('data', data => {
            const logs = this.parseLogsData(data)

            logs.forEach(log => {

                if (log.potentiallyPartial) {
                    outTmpLogs.push(log)
                    return
                } else if (outTmpLogs.length > 0) {

                    outTmpLogs.push(log)

                    log = {
                        date: outTmpLogs[0].date,
                        message: outTmpLogs.reduce((merged, log) => merged + log.message, '')
                    }

                    outTmpLogs = []
                }

                delete log.potentiallyPartial

                lastLogAt = log.date

                this.dispatchLog(log)
            })
        })

        sstream.once('close', () => {
            //this.logger?.debug('Stream of listen container logs closed')
            setTimeout(() => {
                if (abortSignal.aborted) {
                    //this.logger?.debug('Aborting listen of container logs')
                    return
                }

                this.abortController!.abort()
                this.connectAndListen(new Date(new Date(lastLogAt).getTime() + 1))

            }, 200)
        })
    }

    protected parseLogsData(rawLogs: Buffer): any[] {

        if (!rawLogs.subarray(1, 4).equals(trippleNull)) {
            const [t, ...v] = rawLogs.toString().trimEnd().split(' ')

            const message = v.join(' ')

            return [{
                date: t,
                message,
                potentiallyPartial: message.length === 16384
            }]

        }

        if (rawLogs.length === 0) {
            return []
        }

        let logs = []
        let i = 0

        while(true) {
            const stream = rawLogs[i] === 1 ? 'stdout' : 'stderr'
            i++
            i = i + 3 // unused
            const size = rawLogs.readInt32BE(i)

            i = i + 4

            const msgWithTimestamp = rawLogs.subarray(i, i + size).toString().trimEnd()
            const [t, ...v] = msgWithTimestamp.split(' ')

            logs.push({
                date: t,
                stream,
                message:v.join(' '),
                potentiallyPartial: size === 16415
            })
            i = i + size

            if (i >= rawLogs.length) {
                break;
            }

        }

        return logs
    }
}
