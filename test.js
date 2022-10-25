const fs = require('fs')
const {Worker, isMainThread, parentPort} = require('worker_threads')

if (isMainThread) {
  function toArr(str) {
    let len = str.length
    let res = new Uint16Array(len)
    for (let i = 0, l = len; i < l; i++) {
      res[i] = str.charCodeAt(i)
    }
    return res
  }
  let content = fs.readFileSync('./build/index.js', 'utf8')
  let lines = content.split(/\r?\n/)
  console.log(lines.length)
  let worker = new Worker(__filename, {workerData: ''})
  worker.on('message', msg => {
    console.log(`cost:`, Date.now() - ts)
    console.log('message from worker:', msg)
    worker.postMessage('exit')
  })
  worker.on('error', e => {
    console.error('worker error', e)
  })
  worker.on('exit', code => {
    console.log(`worker exit with code ${code}`)
  })
  let ts

  setTimeout(() => {
    ts = Date.now()
    // let arr = lines.map(s => toArr(s))
    // console.log(`cost:`, Date.now() - ts)
    worker.postMessage(lines)
  }, 1000)
} else {
  parentPort.on('message', (value) => {
    parentPort.postMessage({length: value.length})
    if (value === 'exit') {
      process.exit()
    }
  })
}
