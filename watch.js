const chokidar = require('chokidar')

const watcher = chokidar.watch('src/**/*.ts', {
  ignored: /^(node_modules|src\/__tests__)/,
  persistent: true
})

let revision = ''

async function start() {
  console.log('build starting')
  let result = await require('esbuild').build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    sourcemap: process.env.NODE_ENV === 'development',
    define: {REVISION: '"' + revision + '"', ESBUILD: 'true'},
    mainFields: ['module', 'main'],
    platform: 'node',
    target: 'node10.12',
    outfile: 'build/index.js',
    incremental: true
  })
  console.log('build finished')

  watcher.on('change', async () => {
    console.log('build starting')
    await result.rebuild()
    console.log('build finished')
  })
}

start()
