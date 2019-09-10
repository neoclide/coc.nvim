import path from 'path'
import fs from 'fs'
import glob from 'glob'
import { tmpdir } from 'os'
import util from 'util'
import { validSocket } from './fs'

export default async function(): Promise<void> {
  if (global.hasOwnProperty('__TEST__')) return
  try {
    let dir = tmpdir()
    let files = glob.sync(path.join(dir, '/coc-*.sock'))
    for (let file of files) {
      let valid = await validSocket(file)
      if (!valid) await util.promisify(fs.unlink)(file)
    }
    files = glob.sync(path.join(dir, '/coc-nvim-tscancellation-*'))
    for (let file of files) {
      await util.promisify(fs.unlink)(file)
    }
    files = glob.sync(path.join(dir, '/ti-*.log'))
    for (let file of files) {
      await util.promisify(fs.unlink)(file)
    }
    files = glob.sync(path.join(dir, '/coc-*.vim'))
    for (let file of files) {
      if (path.basename(file) != `coc-${process.pid}.vim`) {
        await util.promisify(fs.unlink)(file)
      }
    }
    dir = process.env.XDG_RUNTIME_DIR || dir
    files = glob.sync(path.join(dir, '/coc-nvim-*.log'))
    for (let file of files) {
      if (path.basename(file) != `coc-nvim-${process.pid}.log`) {
        await util.promisify(fs.unlink)(file)
      }
    }
  } catch (e) {
    // noop
  }
}
