import { Worker } from 'node:worker_threads'
import { resolveObjectURL } from 'node:buffer'

export const activeWorkers = new Set()
export class BrowserWorker {
  onmessage = null
  onerror = null
  stopped = false
  constructor(url) {
    this.ready = resolveObjectURL(url).text().then(source => {
      if (this.stopped) return null
      const bootstrap = `import { parentPort } from 'node:worker_threads';
        globalThis.self = { postMessage: value => parentPort.postMessage(value) };
        parentPort.on('message', data => self.onmessage({ data }));\n${source}`
      const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bootstrap)))
      activeWorkers.add(worker)
      worker.on('message', data => this.onmessage?.({ data }))
      worker.on('error', error => this.onerror?.({ message: error.message }))
      worker.on('exit', () => activeWorkers.delete(worker))
      return worker
    })
  }
  postMessage(data) { void this.ready.then(worker => { if (!this.stopped) worker?.postMessage(data) }) }
  terminate() { this.stopped = true; void this.ready.then(worker => worker?.terminate()) }
}
export const waitUntil = async predicate => {
  const deadline = Date.now() + 2500
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待真实线程或视图完成超时')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
