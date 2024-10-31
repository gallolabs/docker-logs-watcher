import Dockerode from 'dockerode'
import { omit } from 'lodash-es'

export interface ContainerRunInfo {
    name: string
    id: string
    image: {
        name: string
        tag: string
    }
    runningUpdateAt: Date
    running: boolean
    labels: Record<string, string>
    compose?: {
        project: string
        service: string
    }
}

interface Watcher {
    cb: (containerRunningState: ContainerRunInfo) => void
    abortSignal: AbortSignal
}

export class DockerContainersRunStateWatcher {
    protected dockerode = new Dockerode
    protected containers: ContainerRunInfo[] = []
    protected abortController?: AbortController
    protected watchers: Watcher[] = []

    public watch(watcher: Watcher) {
        if (watcher.abortSignal.aborted) {
            return
        }

        this.start()
        this.watchers.push(watcher)

        watcher.abortSignal.addEventListener('abort', () => {
            this.watchers.splice(this.watchers.indexOf(watcher), 1)
            if (this.watchers.length === 0) {
                this.stop()
            }
        })

        this.containers.forEach(container => {
            watcher.cb(container)
        })
    }

    protected restart() {
        this.stop()
        this.start()
    }

    protected stop() {
        this.abortController?.abort()
        delete this.abortController
    }

    protected dispatchChange(container: ContainerRunInfo) {
        this.watchers.forEach(watcher => {
            this.dispatchChangeForWatcher(container, watcher)
        })
    }

    protected dispatchChangeForWatcher(container: ContainerRunInfo, watcher: Watcher) {
        watcher.cb(container)
    }

    protected async start() {
        if (this.abortController) {
            return
        }

        this.abortController = new AbortController
        const abortSignal = this.abortController.signal

        let stream

        try {
            stream = await this.dockerode.getEvents({
                filters: {
                    type: ['container']
                },
                abortSignal: abortSignal
            })
        } catch (e) {
            if (!abortSignal.aborted) {
                //this.logger?.warning('Unexpected error on getting events for containers', {e})
                this.restart()
            }

            return
        }

        this.updateInfosFromScratch(this.abortController.signal)

        stream.once('close', () => {
            if (!abortSignal.aborted) {
                //this.logger?.warning('Unexpected closed stream for events')
                this.restart()
            } else {
                //this.logger?.debug('Closed stream for events')
            }
        })

        stream.on('data', (data) => {
            const dEvent = JSON.parse(data.toString())

            if (!['start', 'die', 'destroy'].includes(dEvent.Action)) {
                return
            }

            const eventDate = new Date(dEvent.timeNano / 1000 / 1000)

            const container: ContainerRunInfo = {
                name: dEvent.Actor.Attributes.name,
                id: dEvent.id,
                image: {
                    name: dEvent.Actor.Attributes.image.split(':')[0],
                    tag: dEvent.Actor.Attributes.image.split(':').slice(1).join(':') || 'latest'
                },
                labels: omit(dEvent.Actor.Attributes, ['image', 'name']),
                ...dEvent.Actor.Attributes['com.docker.compose.project']
                    && {
                        compose: {
                            project: dEvent.Actor.Attributes['com.docker.compose.project'],
                            service: dEvent.Actor.Attributes['com.docker.compose.service']
                        }
                    },
                running: dEvent.Action === 'start',
                runningUpdateAt: eventDate
            }

            const ci = this.containers.find(ci => ci.id === container.id)

            if (!ci) {

                if (dEvent.Action === 'destroy') {
                    return
                }

                this.containers.push(container)
                this.dispatchChange(container)
                return
            }

            if (ci.running !== container.running) {
                ci.running = container.running
                ci.runningUpdateAt = container.runningUpdateAt
                this.dispatchChange(ci)
            }

            if (dEvent.Action === 'destroy') {
                this.containers.splice(this.containers.indexOf(ci), 1)
            }
        })
    }

    protected async updateInfosFromScratch(abortSignal: AbortSignal) {
        const fromScratchDate = new Date
        let dockerContainers

        try {
            dockerContainers = await this.dockerode.listContainers({all: true})
        } catch (e) {
            if (!abortSignal.aborted) {
                //this.logger?.warning('Unexpected error on listening containers', {e})
                this.updateInfosFromScratch(abortSignal)
            }

            return
        }

        if (abortSignal.aborted) {
            return
        }

        const containers: ContainerRunInfo[] = dockerContainers.map(c => ({
            name: c.Names[0].substring(1),
            id: c.Id,
            image: {
                name: c.Image.split(':')[0],
                tag: c.Image.split(':').slice(1).join(':') || 'latest'
            },
            labels: c.Labels,
            ...c.Labels['com.docker.compose.project']
                && {
                    compose: {
                        project: c.Labels['com.docker.compose.project'],
                        service: c.Labels['com.docker.compose.service']
                    }
                },
            running: c.State === 'running',
            runningUpdateAt: fromScratchDate
        }))

        // Removing old containers
        this.containers = this.containers.filter(containerInfo => {
            if (containerInfo.runningUpdateAt > fromScratchDate) {
                return true
            }
            if (containers.find(c => c.id === containerInfo.id)) {
                return true
            }

            containerInfo.running = false

            this.dispatchChange(containerInfo)

            return false
        })

        // Updating containers
        containers.forEach(container => {
            const ci = this.containers.find(ci => ci.id === container.id)

            if (!ci) {
                this.containers.push(container)
                this.dispatchChange(container)
                return
            }

            if (ci.runningUpdateAt > fromScratchDate) {
                return
            }

            ci.runningUpdateAt = fromScratchDate
            if (ci.running !== container.running) {
                ci.running = container.running
                ci.runningUpdateAt = container.runningUpdateAt
                this.dispatchChange(ci)
            }
        })

    }
}
