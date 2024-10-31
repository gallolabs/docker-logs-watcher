<p align="center">
    <img height="200" src="https://raw.githubusercontent.com/gallolabs/docker-logs-watcher/main/logo_w200.jpeg">
  <p align="center"><strong>Gallolabs Docker Logs Watcher</strong></p>
</p>

Follow docker logs based on criteria :)

- [x] Follow on container patterns (using component matcher, on container name, id, image, compose, labels), stdout/stdin/both
- [x] Realtime
- [x] Docker disconnects tolerance
- [x] Very fast containers (unless others tested components, but this is thanks to a small hack)
- [ ] Possibly non-realtime logs in case of long disconnections. In case of disconnect, it reconnects requesting logs since last log to fetch missed logs. If the disconnection was some seconds, it makes sense (depending of the realtime window). Why not define a max "realtime" gap/window ?
- [ ] Optimize container stream using dual stdout/stderr when both are watched ?
- [ ] Unordered logs in some cases (very fast loggin in stdout and stderr). Example : docker run node:16-alpine sh -c 'echo OK; echo ERROR >&2; exit 1' will show in random order the messages, also in the console. Adding -t option resolves, but impact the container. Probably no fix, even with attach api.
- [ ] Using run -t outputs only in stdout. The order is respected. Note that in the console also it is to STDOUT. Probably no fix.
- [ ] Multiline support
- [X] watch as stream
- [ ] Subscrive containers with dedicated stream(s)
- [ ] Add events to replace logger

## Motivations

The main goal of the tool is to read in realtime the logs of my containers and makes some metrics (errors, operations) and see them in grafana with alerts.

THIS IS NOT a tool to collect logs. I tested some tools like logspout, interesting because it can be used to collect logs AND to consume them, but the projects seems to be not maintened. Using a tool as container to collect logs or configuring the logging driver (thanks to dual-logging, you also can read log with docker daemon) like Loki is more appropriated (but it was disastrous for me).

## How to use

```typescript
import { DockerLogs } from '@gallofeliz/docker-logs'

const abortController = new AbortController

const dockerLogs = new DockerLogs()

dockerLogs.watch({
    containerMatches: { name: ['*', '!*special*'] },
    stream: 'both',
    onLog(log) {
        const name = log.container.compose
            ? log.container.compose.project + '/' + log.container.compose.service
            : log.container.name
        console.log(log.stream.toUpperCase(), log.date.toISOString(), '-', name, '-', log.message)
    },
    abortSignal: abortController.signal
})

dockerLogs.watch({
    containerMatches: { compose: { project: 'special' } },
    stream: 'stderr',
    onLog(log) {
        console.log('SPECIAL STDERR', log.date.toISOString(), '-', log.container.name, '-', log.message)
    },
    abortSignal: abortController.signal
})

const stream = dockerLogs.stream({
    containerMatches: { name: '*special*' },
    stream: 'both',
    abortSignal: abortController.signal
})

stream.on('data', console.log)
stream.pipe(otherStreamObjectMode)

for await (const log of dockerLogs.stream({
    stream: 'both',
    abortSignal: abortController.signal
})) {
    console.log(log)
}

setTimeout(() => { abortController.abort() }, 30000)
```

will produce with my tests (a docker compose with a a micro script that says start, then work then crashes with badadoom to test last log on crash (bug with Docker in some versions)) :
```
STDERR 2023-07-07T23:49:05.916366512Z - docker-logs/test - Error: Badaboom
STDOUT 2023-07-07T23:49:06.542877623Z - docker-logs/test - start
SPECIAL STDERR 2023-07-07T23:49:14.062961523Z - very-special-container - ERRORRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR
STDOUT 2023-07-07T23:49:16.555776232Z - docker-logs/test - work
STDERR 2023-07-07T23:49:26.568193389Z - docker-logs/test - Error: Badaboom
STDOUT 2023-07-07T23:49:27.331012301Z - docker-logs/test - start
```

