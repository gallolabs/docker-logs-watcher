import { DockerLogs, DockerLog } from '../src/index.js'
import chalk from 'chalk'
import { Writable } from 'stream'
import { setTimeout } from 'timers/promises'

describe('docker logs', () => {
    it('no test', () => {
        new DockerLogs()
    })

    it('manual', async() => {


        const abortController = new AbortController;

        const dockerLogs = new DockerLogs()

        // dockerLogs.watch({
        //     namePattern: ['*', '!*special*'],
        //     stream: 'both',
        //     onLog(log) {
        //         const name = log.container.compose
        //             ? log.container.compose.project + '/' + log.container.compose.service
        //             : log.container.name
        //         console.log(log.stream.toUpperCase(), log.date, '-', name, '-', log.message)
        //     },
        //     abortSignal: abortController.signal
        // })

        const colors: any = {
        }

        const rdClr = () => Math.floor(Math.random() * 255);

        const onLog = (log: DockerLog) => {

            const name = log.container.compose
                ? log.container.compose.project + '/' + log.container.compose.service
                : log.container.name

            const superName = (name + ' '.repeat(30)).substring(0, 30)

            if (!colors[log.container.name]) {
                colors[log.container.name] = chalk.rgb(rdClr(), rdClr(), rdClr())
            }

            const llog = colors[log.container.name](superName+ '  | ') + log.date.toISOString() + ' ' + log.message

            if (log.stream === 'stdout') {
                console.log(llog)
            } else {
                console.error(llog)
            }
        }

        (async () => {
            try {
                for await (const log of dockerLogs.watch({
                    stream: 'both',
                    abortSignal: abortController.signal
                })) {
                    onLog(log)
                }

            } catch (e) {
                if (!abortController.signal.aborted) {
                    throw e
                }
            }
        })()

        const stream = dockerLogs.watch({
            stream: 'both',
            abortSignal: abortController.signal
        })

        const formatLogStream = new Writable({
            objectMode: true,
            write(log: DockerLog, _, cb) {
                onLog(log)
                cb()
            }
        })

        //stream.on('data', onLog)
        stream.pipe(formatLogStream)

        dockerLogs.watch({
            stream: 'both',
            onLog,
            abortSignal: abortController.signal
        })

        dockerLogs.watch({
            containerMatches: {
                compose: {
                    service: '*test*'
                }
                //'compose.service': '*test*'
            },
            stream: 'both',
            onLog(log: DockerLog) {
                console.log(log)
            },
            abortSignal: abortController.signal
        })

        // dockerLogs.watch({
        //     namePattern: '*special*',
        //     stream: 'stderr',
        //     onLog(log) {
        //         console.log('SPECIAL STDERR', log.date, '-', log.container.name, '-', log.message)
        //     },
        //     abortSignal: abortController.signal
        // })

        await setTimeout(5000)

        abortController.abort()
        // sudo docker run --name very-special-container --rm node:16-alpine sh -c 'echo 'Hello'; echo ERRORRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR >&2; exit 1'


    }).timeout(10000)
})
