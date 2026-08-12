'use strict'

import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const projectRoot = path.resolve(here, '../..')

// Runner bookkeeping (LPT timings) and the shared editor-runtime bundle live
// here. Test-file compilation output and dependency records stay in the main
// process and are transferred only to the execution endpoint that needs them.
export const cacheDir = path.join(projectRoot, '.cache/coc-test')

// The editor-runtime bundle is built ONCE by the parent and written here;
// every test child requires this file directly (bundle.js.map next to it,
// linked via sourceMappingURL, keeps the JS file small). Inside the repo's
// gitignored .cache so the build never leaks into the worktree.
export const bundleFile = path.join(cacheDir, 'bundle.js')
