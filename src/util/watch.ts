import debounce from 'debounce'
import fs from 'fs'
import { Disposable } from 'vscode-languageserver-protocol'
const logger = require('./logger')('util-watch')

export function watchFiles(uris: string[], onChange: () => void): Disposable {
  let callback = debounce(onChange, 200)
  let watchers = []
  for (let uri of uris) {
    if (!fs.existsSync(uri)) continue
    let watcher = fs.watch(uri, {
      persistent: false,
      recursive: false,
      encoding: 'utf8'
    }, () => {
      callback()
    })
    watchers.push(watcher)
  }
  return Disposable.create(() => {
    for (let watcher of watchers) {
      watcher.close()
    }
  })
}
