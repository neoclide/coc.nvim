const cp = require('child_process')
const fs = require('fs')
const path = require('path')
let revision = ''
try {
  let res = cp.execSync('git rev-parse HEAD', {encoding: 'utf8'})
  revision = res.trim().slice(0, 10)
} catch (e) {
  // ignore
}

// replace require.main with empty string
let envPlugin = {
  name: 'env',
  setup(build) {
    build.onResolve({filter: /\/appenders/}, args => {
      let fullpath = path.join(args.resolveDir, args.path)
      return {
        path: path.relative(__dirname, fullpath),
        namespace: 'env-ns'
      }
    })
    build.onLoad({filter: /^node_modules\/log4js\/lib\/appenders$/, namespace: 'env-ns'}, args => {
      let content = fs.readFileSync(path.join(args.path, 'index.js'), 'utf8')
      return {
        contents: content.replace(/require\.main/g, '""'),
        resolveDir: args.path
      }
    })
  }
}

async function start() {
  await require('esbuild').build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    define: {REVISION: '"' + revision + '"', ESBUILD: 'true'},
    mainFields: ['module', 'main'],
    format: 'iife',
    platform: 'node',
    target: 'node10.12',
    outfile: 'build/index.js',
    plugins: [envPlugin]
  })
}

start().catch(e => {
  console.error(e)
})
