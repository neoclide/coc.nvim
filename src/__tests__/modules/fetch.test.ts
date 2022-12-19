import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'
import { promisify } from 'util'
import http, { Server } from 'http'
import semver from 'semver'
import download, { getEtag, getExtname } from '../../model/download'
import fetch, { getAgent, getDataType, request, getText, getRequestModule, getSystemProxyURI, resolveRequestOptions, toURL, toPort } from '../../model/fetch'
import helper from '../helper'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'

process.env.NO_PROXY = '*'
let port: number
beforeAll(async () => {
  await helper.setup()
  port = await createServer()
})

afterAll(async () => {
  await helper.shutdown()
  for (let server of servers) {
    server.close()
  }
  servers = []
})

afterEach(() => {
  helper.workspace.configurations.reset()
})

let httpPort = 7000
export function getPort(): Promise<number> {
  let port = httpPort
  let fn = cb => {
    let server = net.createServer()
    server.listen(port, () => {
      server.once('close', () => {
        httpPort = port + 1
        cb(port)
      })
      server.close()
    })
    server.on('error', () => {
      port += 1
      fn(cb)
    })
  }
  return new Promise(resolve => {
    fn(resolve)
  })
}

let servers: Server[] = []
async function createServer(): Promise<number> {
  let port = await getPort()
  return await new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/bad_json') {
        res.writeHead(200, { 'Content-Type': 'application/json;charset=utf8' })
        res.end('{"x"')
      }
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200)
          res.end('abc')
        }, 50)
      }
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json;charset=utf8' })
        res.end(JSON.stringify({ result: 'succeed' }))
      }
      if (req.url === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('text')
      }
      if (req.url === '/404') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
      }
      if (req.url === '/reject') {
        setTimeout(() => {
          res.socket.destroy(new Error('Rejected'))
        }, 20)
      }
      if (req.url === '/close') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.write("foo")
        setTimeout(() => {
          res.destroy(new Error('closed'))
        }, 20)
      }
      if (req.url === '/binary') {
        let file = path.join(os.tmpdir(), 'binary_file')
        if (!fs.existsSync(file)) {
          res.writeHead(404)
          res.end()
          return
        }
        let stat = fs.statSync(file)
        res.setHeader('Content-Length', stat.size)
        res.setHeader('Etag', '"4c6426ac7ef186464ecbb0d81cbfcb1e"')
        res.writeHead(200)
        let stream = fs.createReadStream(file, { highWaterMark: 10 * 1024 })
        stream.pipe(res)
      }
      if (req.url.startsWith('/zip')) {
        let zipfile = path.resolve(__dirname, '../test.zip')
        if (req.url.indexOf('nolength=1') == -1) {
          let stat = fs.statSync(zipfile)
          res.setHeader('Content-Length', stat.size)
          res.setHeader('Content-Disposition', 'attachment')
        }
        res.setHeader('Content-Type', 'application/zip')
        res.writeHead(200)
        let stream = fs.createReadStream(zipfile, { highWaterMark: 1 * 1024 })
        stream.pipe(res)
      }
      if (req.url === '/tgz') {
        res.setHeader('Content-Disposition', 'attachment; filename="file.tgz"')
        res.setHeader('Content-Type', 'application/octet-stream')
        let tarfile = path.resolve(__dirname, '../test.tar.gz')
        let stat = fs.statSync(tarfile)
        res.setHeader('Content-Length', stat.size)
        res.writeHead(200)
        let stream = fs.createReadStream(tarfile)
        stream.pipe(res)
      }
    })
    servers.push(server)
    server.unref()
    server.listen(port, () => {
      resolve(port)
    })
  })
}

describe('utils', () => {
  it('should getText', () => {
    expect(getText({ x: 1 })).toBe('{"x":1}')
  })

  it('should getExtname', () => {
    let res = getExtname('attachment; x="y"')
    expect(res).toBeUndefined()
  })

  it('should getPort', async () => {
    expect(toPort(80, 'http')).toBe(80)
    expect(toPort('80', 'http')).toBe(80)
    expect(toPort('x', 'http')).toBe(80)
    expect(toPort('', 'https')).toBe(443)
  })

  it('should getEtag', () => {
    expect(getEtag({})).toBeUndefined()
    expect(getEtag({ etag: '"abc"' })).toBe('abc')
    expect(getEtag({ etag: 'W/"abc"' })).toBe('abc')
    expect(getEtag({ etag: 'Wabc"' })).toBeUndefined()
  })

  it('should get data type', () => {
    expect(getDataType(null)).toBe('null')
    expect(getDataType(undefined)).toBe('undefined')
    expect(getDataType('s')).toBe('string')
    let b = Buffer.from('abc', 'utf8')
    expect(getDataType(b)).toBe('buffer')
    expect(getDataType({})).toBe('object')
    expect(getDataType(new Date())).toBe('unknown')
  })

  it('should getRequestModule', () => {
    let url = toURL('https://www.baidu.com')
    expect(getRequestModule(url)).toBeDefined()
  })

  it('should convert to URL', () => {
    expect(() => { toURL('') }).toThrow()
    expect(() => { toURL('file:///1') }).toThrow()
    expect(() => { toURL(undefined) }).toThrow()
    expect(toURL('https://www.baidu.com').toString()).toBe('https://www.baidu.com/')
    let u = new URL('http://www.baidu.com')
    expect(toURL(u)).toBe(u)
  })

  it('should report valid proxy', () => {
    let agent = getAgent(new URL('http://google.com'), { proxy: 'domain.com:1234' })
    expect(agent).toBe(null)

    agent = getAgent(new URL('http://google.com'), { proxy: 'ftp://domain.com:1234' })
    expect(agent).toBe(null)

    agent = getAgent(new URL('http://google.com'), { proxy: '' })
    expect(agent).toBe(null)

    agent = getAgent(new URL('http://google.com'), { proxy: 'domain.com' })
    expect(agent).toBe(null)

    agent = getAgent(new URL('https://google.com'), { proxy: 'https://domain.com' })
    let proxy = (agent as any).proxy
    expect(proxy.port).toBe(443)

    agent = getAgent(new URL('http://google.com'), { proxy: 'http://domain.com', proxyStrictSSL: true })
    proxy = (agent as any).proxy
    expect(proxy.port).toBe(80)

    agent = getAgent(new URL('http://google.com'), { proxy: 'https://domain.com:1234' })
    proxy = (agent as any).proxy
    expect(proxy.host).toBe('domain.com')
    expect(proxy.port).toBe(1234)

    agent = getAgent(new URL('http://google.com'), { proxy: 'http://user:pass@domain.com:1234' })
    proxy = (agent as any).proxy
    expect(proxy.host).toBe('domain.com')
    expect(proxy.port).toBe(1234)
    expect(proxy.auth).toBe('user:pass')
  })

  it('should getAgent from proxy', () => {
    let agent = getAgent(new URL('http://google.com'), { proxy: 'http://user:@domain.com' })
    let proxy = (agent as any).proxy
    expect(proxy.host).toBe('domain.com')
    expect(proxy.auth).toBe('user:')
    expect(proxy.port).toBe(80)
  })

  it('should getSystemProxyURI', () => {
    let url = new URL('http://www.example.com')
    let http_proxy = 'http://127.0.0.1:7070'
    expect(getSystemProxyURI(url, { NO_PROXY: '*', HTTP_PROXY: http_proxy })).toBeNull()
    expect(getSystemProxyURI(url, { no_proxy: '*', HTTP_PROXY: http_proxy })).toBeNull()
    expect(getSystemProxyURI(new URL('http://www.example.com:80'), {
      NO_PROXY: 'xyz:33,example.com:80',
      HTTP_PROXY: http_proxy
    })).toBeNull()
    expect(getSystemProxyURI(url, {
      NO_PROXY: 'baidu.com,example.com',
      HTTP_PROXY: http_proxy
    })).toBeNull()
    expect(getSystemProxyURI(url, { HTTP_PROXY: http_proxy })).toBe(http_proxy)
    expect(getSystemProxyURI(url, { http_proxy })).toBe(http_proxy)
    expect(getSystemProxyURI(url, {})).toBe(null)
    url = new URL('https://www.example.com')
    let https_proxy = 'https://127.0.0.1:7070'
    expect(getSystemProxyURI(url, { HTTPS_PROXY: https_proxy })).toBe(https_proxy)
    expect(getSystemProxyURI(url, { https_proxy })).toBe(https_proxy)
    expect(getSystemProxyURI(url, { HTTP_PROXY: http_proxy })).toBe(http_proxy)
    expect(getSystemProxyURI(url, { http_proxy })).toBe(http_proxy)
    expect(getSystemProxyURI(url, {})).toBe(null)
  })

  it('should resolve request options #1', async () => {
    let file = path.join(os.tmpdir(), `${uuid()}/ca`)
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, 'ca', 'utf8')
    helper.updateConfiguration('http.proxyAuthorization', 'authorization')
    helper.updateConfiguration('http.proxyCA', file)
    let url = new URL('http://www.example.com:7070')
    let res = resolveRequestOptions(url, {
      query: { x: 1 },
      method: 'POST',
      headers: {
        'Custom-X': '1'
      },
      user: 'user',
      password: 'password',
      timeout: 1000,
      data: { foo: '1' },
      buffer: true,
    })
    expect(res.path).toBe('/?x=1')
    expect(Buffer.isBuffer(res.ca)).toBe(true)
  })

  it('should resolve request options #2', async () => {
    let url = new URL('https://abc:123@www.example.com')
    let res = resolveRequestOptions(url, {
      user: 'user',
      data: 'data'
    })
    expect(res.port).toBe(443)
    expect(res.path).toBe('/')
    expect(res.auth).toBe('abc:123')
  })
})

describe('fetch', () => {

  it('should fetch json', async () => {
    let res = await fetch(`http://127.0.0.1:${port}/json`, {
      method: 'POST',
      data: 'data'
    })
    expect(res).toEqual({ result: 'succeed' })
    res = await fetch(`http://127.0.0.1:${port}/json`, { buffer: true })
    expect(Buffer.isBuffer(res)).toBe(true)
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/bad_json`)
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should catch error on reject or abnormal response', async () => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/reject`)
    }
    await expect(fn()).rejects.toThrow()
  })

  it('should catch abnormal close', async () => {
    let version = semver.parse(process.version)
    if (version.major >= 16) {
      let fn = async () => {
        await fetch(`http://127.0.0.1:${port}/close`)
      }
      await expect(fn()).rejects.toThrow()
      fn = async () => {
        await download(`http://127.0.0.1:${port}/close`, { dest: os.tmpdir() })
      }
      await expect(fn()).rejects.toThrow()
    }
  })

  it('should throw on 404 response', async () => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/404`)
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should catch proxy error', async () => {
    delete process.env.NO_PROXY
    process.env.HTTP_PROXY = `http://127.0.0.1`
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/json`)
    }
    await expect(fn()).rejects.toThrow()
    delete process.env.HTTP_PROXY
  })

  it('should fetch text', async () => {
    let res = await fetch(`http://127.0.0.1:${port}/text`)
    expect(res).toBe('text')
    let fn = async () => {
      let port = await getPort()
      res = await fetch(`http://127.0.0.1:${port}/not_exists`, { timeout: 2000 })
    }
    await expect(fn()).rejects.toThrow()
  })

  it('should throw on timeout', async () => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/slow`, { timeout: 50 })
    }
    await expect(fn()).rejects.toThrow(Error)
    let url = new URL(`http://127.0.0.1:${port}/slow`)
    let opts = {
      method: 'GET',
      hostname: '127.0.0.1',
      port,
      path: '/slow',
      rejectUnauthorized: true,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
        'Accept-Encoding': 'gzip, deflate'
      },
      timeout: 50,
      agent: new http.Agent({ keepAlive: true })
    }
    fn = async () => {
      await request(url, undefined, opts)
    }
    await expect(fn()).rejects.toThrow(Error)
    fn = async () => {
      await download(url, Object.assign(opts, { dest: os.tmpdir() }))
    }
    await expect(fn()).rejects.toThrow(Error)

    opts.agent.destroy()
  })

  it('should cancel by CancellationToken', async () => {
    let fn = async () => {
      let tokenSource = new CancellationTokenSource()
      let p = fetch(`http://127.0.0.1:${port}/slow`, { timeout: 50 }, tokenSource.token)
      await helper.wait(1)
      tokenSource.cancel()
      await p
    }
    await expect(fn()).rejects.toThrow(Error)
  })
})

describe('download', () => {
  let binary_file: string
  let tempdir = path.join(os.tmpdir(), uuid())

  beforeAll(async () => {
    binary_file = path.join(os.tmpdir(), 'binary_file')
    if (!fs.existsSync(binary_file)) {
      let data = Buffer.alloc(100 * 1024, 0)
      await promisify(fs.writeFile)(binary_file, data)
    }
    // create binary files
  })

  it('should throw for bad option', async () => {
    let url = 'https://127.0.0.1'
    let fn = async () => {
      await download(url, { dest: 'a/b' })
    }
    await expect(fn()).rejects.toThrow(Error)
    fn = async () => {
      await download(url, { dest: __filename })
    }
    await expect(fn()).rejects.toThrow(/not directory/)
  })

  it('should throw when unable to extract', async () => {
    let url = `http://127.0.0.1:${port}/text`
    let fn = async () => {
      await download(url, { dest: tempdir, extract: true })
    }
    await expect(fn()).rejects.toThrow(/extract method/)
  })

  it('should throw for bad response', async () => {
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/404`, { dest: tempdir })
    }
    await expect(fn()).rejects.toThrow(Error)
    fn = async () => {
      await download(`http://127.0.0.1:${port}/reject`, { dest: tempdir })
    }
    await expect(fn()).rejects.toThrow()
    fn = async () => {
      let port = await getPort()
      await download(`http://127.0.0.1:${port}/not_exists`, { dest: tempdir, timeout: 2000 })
    }
    await expect(fn()).rejects.toThrow()
  })

  it('should throw on timeout', async () => {
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/slow`, { dest: tempdir, timeout: 50 })
    }
    await expect(fn()).rejects.toThrow()
  })

  it('should download binary file', async () => {
    let url = `http://127.0.0.1:${port}/binary`
    let called = false
    let res = await download(url, {
      etagAlgorithm: 'md5',
      dest: tempdir, onProgress: p => {
        expect(typeof p).toBe('string')
        called = true
      }
    })
    expect(called).toBe(true)
    let exists = fs.existsSync(res)
    expect(exists).toBe(true)
  })

  it('should throw when etag check failed', async () => {
    let url = `http://127.0.0.1:${port}/binary`
    let called = false
    let fn = async () => {
      await download(url, {
        etagAlgorithm: 'sha256',
        dest: tempdir, onProgress: p => {
          expect(typeof p).toBe('string')
          called = true
        }
      })
    }
    await expect(fn()).rejects.toThrow(/Etag check failed/)
  })

  it('should download zip file', async () => {
    let url = `http://127.0.0.1:${port}/zip`
    let res = await download(url, {
      dest: tempdir,
      extract: true
    })
    let file = path.join(tempdir, 'log.txt')
    let exists = fs.existsSync(file)
    expect(exists).toBe(true)
    res = await download(url + '?nolength=1', {
      dest: tempdir,
      extract: true
    })
    exists = fs.existsSync(file)
    expect(exists).toBe(true)
  })

  it('should download tgz', async () => {
    let url = `http://127.0.0.1:${port}/tgz`
    let opts = {
      dest: tempdir,
      extract: true,
      timeout: 3000,
      strip: 0
    }
    let res = await download(url, opts)
    let file = path.join(res, 'test.js')
    let exists = fs.existsSync(file)
    expect(exists).toBe(true)
    opts.strip = undefined
    res = await download(url, opts)
    expect(res).toBeDefined()
  })

  it('should cancel download by CancellationToken', async () => {
    let fn = async () => {
      let tokenSource = new CancellationTokenSource()
      let p = download(`http://127.0.0.1:${port}/slow`, { dest: tempdir }, tokenSource.token)
      await helper.wait(10)
      tokenSource.cancel()
      await p
    }
    await expect(fn()).rejects.toThrow(Error)
  })

  it('should throw on agent error', async () => {
    delete process.env.NO_PROXY
    process.env.HTTP_PROXY = `http://127.0.0.1`
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/json`, { dest: tempdir })
    }
    await expect(fn()).rejects.toThrow(/using proxy/)
    delete process.env.HTTP_PROXY
    process.env.NO_PROXY = '*'
    fn = async () => {
      let agent = new http.Agent({ keepAlive: true })
      let p = download(`http://127.0.0.1:${port}/slow`, { dest: tempdir, timeout: 50, agent })
      await p
      agent.destroy()
    }
    await expect(fn()).rejects.toThrow(/timeout/)
  })
})
