import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import Emitter = require('events')
const logger = require('../util/logger')('model-child')

export type Callback = (msg:string) => void

/**
 * IpcService for commnucate with another nodejs process
 * @public
 *
 * @extends {Emitter}
 */
export default class IpcService extends Emitter {
  private child:ChildProcess
  private running:boolean

  constructor(public modulePath:string, public cwd:string, public execArgv:string[], public args:string[]) {
    super()
    this.modulePath = modulePath
    this.args = args || []
    this.execArgv = execArgv
    this.cwd = cwd
  }

  public get isRunnning():boolean {
    return this.running
  }

  public start():void {
    if (this.running) return
    let {modulePath} = this
    let child = this.child = cp.fork(this.modulePath, this.args, {
      cwd: this.cwd,
      execArgv: this.execArgv,
      stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ]
    })
    this.running = true
    child.stderr.on('data', str => {
      logger.error(`${modulePath} error message: ${str}`)
    })
    child.stdout.on('data', str => {
      logger.debug(`${modulePath} output message: ${str}`)
    })
    child.on('message', message => {
      this.emit('message', message)
    })
    child.on('error', err => {
      logger.error(`service error ${err.message}`)
      logger.debug(`${err.stack}`)
      this.emit('error', err)
    })
    child.on('exit', (code, signal) => {
      this.running = false
      if (code) {
        logger.error(`Service abnormal exit ${code}`)
      }
      logger.debug(`${modulePath} exit with code ${code} and signal ${signal}`)
      this.emit('exit')
    })
  }

  public request(data:{[index:string]: any}):Promise<any> {
    if (!this.running) return
    this.child.send(JSON.stringify(data))
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Ipc service request time out'))
      }, 3000)
      this.once('message', msg => {
        if (!msg) return resolve(null)
        resolve(JSON.parse(msg.toString()))
      })
    })
  }

  public stop():void {
    if (this.child) {
      this.child.kill('SIGHUP')
    }
  }
}
