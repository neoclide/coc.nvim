const cp = require('child_process')
let revision = ''
try {
  let res = cp.execSync('git rev-parse HEAD', {encoding: 'utf8'})
  revision = res.trim().slice(0, 10)
} catch (e) {
  // ignore
}

require('esbuild').buildSync({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV === 'development',
  define: {REVISION: '"' + revision + '"', ESBUILD: 'true'},
  mainFields: ['module', 'main'],
  platform: 'node',
  target: 'node10.12',
  outfile: 'build/index.js',
})
