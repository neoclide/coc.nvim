const cp = require('child_process')
let revision = 'master'
if (process.env.NODE_ENV !== 'development') {
  try {
    let res = cp.execSync(`git log -1 --date=iso --pretty=format:'"%h","%ad"'`, {encoding: 'utf8'})
    revision = res.replaceAll('"', '').replace(',', ' ')
  } catch (e) {
    // ignore
  }
}

let entryPlugin = {
  name: 'entry',
  setup(build) {
    build.onResolve({filter: /^index\.js$/}, args => {
      return {
        path: args.path,
        namespace: 'entry-ns'
      }
    })
    build.onLoad({filter: /.*/, namespace: 'entry-ns'}, () => {
      let contents = `'use strict'
if (global.__isMain) {
  Object.defineProperty(console, 'log', {
    value() {
      if (logger) logger.info(...arguments)
    }
  })
  const { createLogger } = require('./src/logger/index')
  const logger = createLogger('server')
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
      return {
        contents,
        resolveDir: __dirname
      }
    })
  }
}

async function start(watch) {
  await require('esbuild').build({
    entryPoints: ['index.js'],
    bundle: true,
    watch,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    define: {
      REVISION: '"' + revision + '"',
      ESBUILD: 'true',
      'process.env.COC_NVIM': '"1"',
      'global.__TEST__': false
    },
    mainFields: ['module', 'main'],
    platform: 'node',
    treeShaking: true,
    target: 'node14.14',
    plugins: [entryPlugin],
    banner: {
      js: `"use strict";
global.__starttime = Date.now();
global.__isMain = require.main === module;`
    },
    outfile: 'build/index.js'
  })
}

let watch = false
if (process.argv.includes('--watch')) {
  console.log('watching...')
  watch = {
    onRebuild(error) {
      if (error) {
        console.error('watch build failed:', error)
      } else {
        console.log('watch build succeeded')
      }
    },
  }
}

start(watch).catch(e => {
  console.error(e)
})
