'use strict'

import fs from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './paths.mjs'

const testsDir = path.join(projectRoot, 'src', '__tests__')
const unitPrefix = path.join('src', '__tests__', 'unit') + path.sep

/**
 * Tests that need a real Vim channel runtime. Each file in this list runs in
 * its own Vim session (serial, VIM_NODE_RPC=1). Everything else outside the
 * unit directory is an nvim test.
 */
export const VIM_TESTS = [
  'src/__tests__/vim.test.ts',
]

/**
 * Unit files that mutate process-global singletons (configuration registry,
 * factory sandbox) must not share a worker with other files.
 */
export const ISOLATED_UNIT_TESTS = [
  'src/__tests__/unit/configurationModel.test.ts',
  'src/__tests__/unit/factory.test.ts',
]

/**
 * Path-based classification (no `// @coc-test` headers anymore):
 * - `src/__tests__/unit/*.test.ts` -> unit lane (isolated files own worker).
 * - `VIM_TESTS` -> vim lane.
 * - everything else -> nvim lane.
 */
export async function discoverTests(extraFiles = []) {
  const all = []
  if (extraFiles.length > 0) {
    for (const f of extraFiles) {
      const abs = path.resolve(projectRoot, f)
      if (abs.endsWith('.test.ts')) all.push(abs)
    }
  } else {
    const entries = await fs.readdir(testsDir, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue
      all.push(path.join(entry.parentPath, entry.name))
    }
  }
  all.sort()

  const unit = []
  const nvim = []
  const vim = []
  const excluded = []
  for (const file of all) {
    const rel = path.relative(projectRoot, file)
    if (rel.startsWith(unitPrefix)) {
      unit.push({ file: rel, lane: 'unit', isolated: ISOLATED_UNIT_TESTS.includes(rel), runnable: true })
    } else if (VIM_TESTS.includes(rel)) {
      vim.push({ file: rel, lane: 'vim', isolated: false, runnable: true })
    } else {
      nvim.push({ file: rel, lane: 'nvim', isolated: false, runnable: true })
    }
  }
  return { unit, nvim, vim, excluded }
}

export async function discoverUnitTests(extraFiles = []) {
  const { unit, excluded } = await discoverTests(extraFiles)
  return { unit, excluded }
}
