import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import EventEmitter = require('events')
import {VimCompleteItem} from '../types'
const logger = require('../util/logger')('model-child')

export type Callback = (msg:string) => void

export default class IpcService extends EventEmitter {
  private cb:Callback
  private child:ChildProcess
  private running:boolean

  constructor(public modulePath:string, public args?:string[]) {
    super()
    this.modulePath = modulePath
    this.args = args || []
    this.cb = () => { } // tslint:disable-line
  }

  public get isRunnning():boolean {
    return this.running
  }

  public start():void {
    if (this.running) return
    this.child = cp.fork(this.modulePath, this.args, {
      stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ]
    })
    this.running = true
    this.child.on('message', message => {
      logger.debug(`ipc message: ${message}`)
      this.emit('message', message)
    })
    this.child.on('error', err => {
      logger.error(`service error ${err.message}`)
      logger.debug(`${err.stack}`)
      this.emit('error', err)
    })
    this.child.on('exit', (code, signal) => {
      this.running = false
      if (code) {
        logger.error(`Service abnormal exit ${code}`)
      }
      logger.debug(`${this.modulePath} exit with code ${code} and signal ${signal}`)
      this.emit('exit')
    })
  }

  public request(data:{[index:string]: any}):Promise<VimCompleteItem[]> {
    if (!this.running) return
    this.child.send(JSON.stringify(data))
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Ipc service request time out'))
      }, 3000)
      this.once('message', msg => {
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
