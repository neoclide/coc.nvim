import cp from 'node:child_process'

let revision = 'master'
if (process.env.NODE_ENV !== 'development') {
  try {
    let res = cp.execSync(`git log -1 --date=iso --pretty=format:'"%h","%ad"'`, { encoding: 'utf8' })
    revision = res.replaceAll('"', '').replace(',', ' ')
  } catch {}
}

const entryId = '\0coc-entry'
const entryContents = `'use strict'
if (global.__isMain) {
  const { createLogger } = require('./src/logger/index')
  const logger = createLogger('server')
  Object.defineProperty(console, 'log', {
    value() {
      if (logger) logger.info(...arguments)
    }
  })
  process.on('uncaughtException', function(err) {
    let msg = 'Uncaught exception: ' + err.message
    console.error(msg)
    logger.error('uncaughtException', err.stack)
  })
  process.on('unhandledRejection', function(reason, p) {
    if (reason instanceof Error) {
      if (typeof reason.code === 'number') {
        let msg = 'Unhandled response error ' + reason.code + ' from language server: ' + reason.message
        if (reason.data != null) {
          console.error(msg, reason.data)
        } else {
          console.error(msg)
        }
      } else {
        console.error('UnhandledRejection: ' + reason.message + '\\n' + reason.stack)
      }
    } else {
      console.error('UnhandledRejection: ' + reason)
    }
    logger.error('unhandledRejection ', p, reason)
  })
  const attach = require('./src/attach').default
  attach({ reader: process.stdin, writer: process.stdout })
} else {
  const exports = require('./src/index')
  const logger = require('./src/logger').logger
  const attach = require('./src/attach').default
  module.exports = {attach, exports, logger, loadExtension: (filepath, active) => {
    return exports.extensions.manager.load(filepath, active)
  }}
}`

const entryPlugin = {
  name: 'entry',
  resolveId(id) {
    if (id === 'index.js') return entryId
  },
  load(id) {
    if (id === entryId) return entryContents
  }
}

export default {
  input: 'index.js',
  platform: 'node',
  treeshake: true,
  transform: {
    target: 'node20',
    define: {
      REVISION: JSON.stringify(revision),
      'process.env.COC_NVIM': '"1"',
      'global.__TEST__': 'false'
    }
  },
  resolve: {
    mainFields: ['module', 'main']
  },
  plugins: [entryPlugin],
  output: {
    file: 'build/index.js',
    format: 'cjs',
    codeSplitting: false,
    sourcemap: process.env.NODE_ENV === 'development',
    banner: `"use strict";
global.__starttime = Date.now();
global.__isMain = require.main === module;`
  }
}
