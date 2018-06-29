import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import Emitter = require('events')
import {RequestOptions} from 'http'
import got = require('got')
const logger = require('../util/logger')('model-httpService')

export type Callback = (msg:string) => void

export default class HttpService extends Emitter {
  private child:ChildProcess
  private running:boolean

  constructor(public command:string, public args?:string[]) {
    super()
    this.command = command
    this.args = args || []
    this.running = false
  }

  public get isRunnning():boolean {
    return this.running
  }

  public start():void {
    if (this.running) return
    this.child = cp.spawn(this.command, this.args, {
      detached: false
    })
    this.running = true
    this.child.stderr.on('data', str => {
      logger.error(`${this.command} error: ${str}`)
    })
    this.child.stdout.on('data', msg => {
      logger.debug(`${this.command} ourput: ${msg}`)
    })
    this.child.on('exit', (code, signal) => {
      this.running = false
      if (code) {
        logger.error(`${this.command} service abnormal exit ${code}`)
      }
      this.emit('exit')
    })
  }

  public async request(opt:RequestOptions):Promise<string> {
    // if (!this.running) return
    let {port, path, headers} = opt
    try {
      const response = await got(`http://127.0.0.1:${port}${path}`, {
        headers
      })
      let items = JSON.parse(response.body)
      logger.debug(items.length)
      // logger.debug(JSON.stringify(items))
      return response.body
    } catch (e) {
      logger.error(e.message)
    }
    return ''
  }

  public stop():void {
    if (this.child) {
      this.child.kill('SIGHUP')
    }
  }
}
