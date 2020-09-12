import fs from 'fs'
import os from 'os'
import path from 'path'
import rimraf from 'rimraf'
import { parse } from 'url'
import { promisify } from 'util'
import download from '../../model/download'
import fetch, { getAgent } from '../../model/fetch'
import helper from '../helper'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  helper.updateConfiguration('http.proxy', '')
  await helper.reset()
})

describe('fetch', () => {

  it('should fetch json', async () => {
    let res = await fetch('https://nodejs.org/dist/index.json')
    expect(Array.isArray(res)).toBe(true)
  }, 10000)

  it('should throw on request error', async () => {
    let err
    try {
      await fetch('http://not_exists_org')
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should report valid proxy', async () => {
    let agent = getAgent(parse('http://google.com'), { proxyUrl: 'domain.com:1234' })
    expect(agent).toBe(null)

    agent = getAgent(parse('http://google.com'), { proxyUrl: 'https://domain.com:1234' })
    let proxy = (agent as any).proxy
    expect(proxy.host).toBe('domain.com')
    expect(proxy.port).toBe(1234)

    agent = getAgent(parse('http://google.com'), { proxyUrl: 'http://user:pass@domain.com:1234' })
    proxy = (agent as any).proxy
    expect(proxy.host).toBe('domain.com')
    expect(proxy.port).toBe(1234)
    expect(proxy.auth).toBe('user:pass')
  })
})

describe('download', () => {
  it('should download binary file', async () => {
    let url = 'https://registry.npmjs.org/coc-pairs/-/coc-pairs-1.2.13.tgz'
    let tmpFolder = await promisify(fs.mkdtemp)(path.join(os.tmpdir(), 'coc-test'))
    let res = await download(url, { dest: tmpFolder })
    expect(fs.existsSync(res)).toBe(true)
    await promisify(rimraf)(tmpFolder, { glob: false })
  }, 10000)

  it('should download tgz', async () => {
    let url = 'https://registry.npmjs.org/coc-pairs/-/coc-pairs-1.2.13.tgz'
    let tmpFolder = await promisify(fs.mkdtemp)(path.join(os.tmpdir(), 'coc-test'))
    await download(url, { dest: tmpFolder, extract: 'untar' })
    let file = path.join(tmpFolder, 'package.json')
    expect(fs.existsSync(file)).toBe(true)
    await promisify(rimraf)(tmpFolder, { glob: false })
  }, 10000)

  it('should extract zip file', async () => {
    let url = 'https://codeload.github.com/chemzqm/vimrc/zip/master'
    let tmpFolder = await promisify(fs.mkdtemp)(path.join(os.tmpdir(), 'coc-test'))
    await download(url, { dest: tmpFolder, extract: 'unzip' })
    let folder = path.join(tmpFolder, 'vimrc-master')
    expect(fs.existsSync(folder)).toBe(true)
    await promisify(rimraf)(tmpFolder, { glob: false })
  }, 30000)
})
