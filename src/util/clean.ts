import fs from 'fs'
import glob from 'glob'
import { tmpdir } from 'os'
import pify from 'pify'
import { validSocket } from './fs'

export default async function(): Promise<void> {
  try {
    let dir = tmpdir()
    let files = glob.sync(dir + '/coc-*.sock')
    for (let file of files) {
      let valid = await validSocket(file)
      if (!valid) await pify(fs.unlink)(file)
    }
    files = glob.sync(dir + '/coc-nvim-tscancellation-*')
    for (let file of files) {
      await pify(fs.unlink)(file)
    }
    files = glob.sync(dir + '/ti-*.log')
    for (let file of files) {
      await pify(fs.unlink)(file)
    }
  } catch (e) {
    // noop
  }
}
