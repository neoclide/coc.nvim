import * as fs from 'fs'
import debounce = require('debounce')
import {statAsync} from './fs'
const logger = require('./logger')('util-watch')

export function watchFiles(uris: string[], onChange:()=>void):void {
  let callback = debounce(onChange, 200)
  Promise.all(uris.map(uri => {
    return statAsync(uri)
  })).then(stats => {
    for (let i = 0; i < stats.length; i++) {
      if (stats[i].isFile()) {
        fs.watch(uris[i], {
          persistent: false,
          recursive: false,
          encoding: 'utf8'
        }, eventType => {
          if (eventType == 'change') {
            callback()
          }
        })
      }
    }
  }, err => {
    logger.error(err.message)
  })
}
