import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import EventEmitter = require('events')
import {request, RequestOptions} from 'http'
import got = require('got')
const logger = require('../util/logger')('model-httpService')

export type Callback = (msg:string) => void

export default class HttpService extends EventEmitter {
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
    logger.debug(`args:${this.args.join(' ')}`)
    logger.debug(this.command)
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
    // let data = ''
    // return new Promise((resolve, reject) => {
    //   logger.debug(JSON.stringify(opt))
    //   const response = await got('http://127.0.0.1:5588/complete', {
    //     headers: {
    //       'X-Offset': '445',
    //       'X-Path': '/tmp/coc-91386/b6kfm',
    //       'X-File': 'processer/WeatherView.swift'
    //     }
    //   })
    //   console.log(response.body)
    //   const req = request(opt, res => {
    //     logger.debug(`STATUS: ${res.statusCode}`)
    //     logger.debug(`headers: ${JSON.stringify(res.headers)}`)
    //     logger.debug(6666)
    //     res.on('error', reject)
    //     res.on('data', chunk => {
    //       logger.debug(55555)
    //       logger.debug(chunk)
    //       data += chunk.toString()
    //     })
    //     res.on('end', () => {
    //       resolve(data)
    //     })
    //   })
    // })
  }

  public stop():void {
    if (this.child) {
      this.child.kill('SIGHUP')
    }
  }
}
