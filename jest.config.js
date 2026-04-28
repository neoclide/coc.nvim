'use strict'
const { readdirSync, readFileSync } = require('fs')
const { join } = require('path')

function getEsmPackageNames() {
  const result = new Set()
  function scan(nodeModules) {
    let entries
    try { entries = readdirSync(nodeModules) } catch { return }
    for (const pkg of entries) {
      if (pkg.startsWith('.')) continue
      const pkgDir = join(nodeModules, pkg)
      if (pkg.startsWith('@')) {
        // Scoped namespace directory — iterate its children as real packages
        let scopedEntries
        try { scopedEntries = readdirSync(pkgDir) } catch { continue }
        for (const scopedPkg of scopedEntries) {
          const scopedPkgDir = join(pkgDir, scopedPkg)
          try {
            const pkgJson = JSON.parse(readFileSync(join(scopedPkgDir, 'package.json'), 'utf8'))
            if (pkgJson.type === 'module') result.add(`${pkg}/${scopedPkg}`)
          } catch { }
          scan(join(scopedPkgDir, 'node_modules'))
        }
        continue
      }
      try {
        const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
        if (pkgJson.type === 'module') result.add(pkg)
      } catch { }
      scan(join(pkgDir, 'node_modules'))
    }
  }
  scan(join(__dirname, 'node_modules'))
  return [...result]
}

const esmPackages = getEsmPackageNames().map(p => p.replace(/[.+]/g, '\\$&'))

module.exports = {
  globals: { '__TEST__': true },
  projects: ['<rootDir>'],
  watchman: false,
  clearMocks: true,
  globalSetup: './jest.js',
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['<rootDir>/src/__tests__/*'],
  moduleFileExtensions: ['ts', 'tsx', 'json', 'mjs', 'js'],
  transform: {
    '^.+\\.tsx?$': ['@swc/jest'],
    '^.+\\.m?js$': ['@swc/jest'],
  },
  transformIgnorePatterns: [
    `/node_modules/(?!(${esmPackages.join('|')})/)`
  ],
  testRegex: 'src/__tests__/.*\\.(test|spec)\\.ts$',
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: './coverage/',
}
