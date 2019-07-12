import fetch from '../../model/fetch'
import rimraf from 'rimraf'
import download from '../../model/download'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { promisify } from 'util'

describe('fetch', () => {

  it('should fetch json', async () => {
    let res = await fetch('https://nodejs.org/dist/index.json')
    expect(Array.isArray(res)).toBe(true)
  })

  it('should throw on request error', async () => {
    let err
    try {
      await fetch('http://not_exists_org')
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })
})

describe('download', () => {
  it('should download tgz', async () => {
    let url = 'https://registry.npmjs.org/coc-pairs/-/coc-pairs-1.2.13.tgz'
    let tmpFolder = await promisify(fs.mkdtemp)(path.join(os.tmpdir(), 'coc-test'))
    await download(url, { dest: tmpFolder })
    let file = path.join(tmpFolder, 'package.json')
    expect(fs.existsSync(file)).toBe(true)
    await promisify(rimraf)(tmpFolder, { glob: false })
  }, 10000)
})
