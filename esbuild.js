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

async function start(watch) {
  await require('esbuild').build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    watch,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    define: {REVISION: '"' + revision + '"', ESBUILD: 'true', 'global.__TEST__': false},
    mainFields: ['module', 'main'],
    platform: 'node',
    target: 'node14.14',
    charset: 'utf8',
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    banner: {
      js: `global.__starttime = Date.now();`
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
