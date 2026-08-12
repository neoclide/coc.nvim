import workspace from '../../workspace'
import * as shared from '../sharedUtil'
import fs from 'fs'
import http, { Server } from 'http'
import net from 'net'
import os from 'os'
import path from 'path'
import semver from 'semver'
import { URL } from 'url'
import { promisify } from 'util'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import download, { getEtag, getExtname } from '../../model/download'
import fetch, { getAgent, getDataType, getRequestModule, getSystemProxyURI, getText, request, resolveRequestOptions, toPort, toURL } from '../../model/fetch'
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

process.env.NO_PROXY = '*'
let port: number
let servers: Server[] = []
let currentPort = 5000
before(async () => {
  port = await createServer()
})

after(async () => {
  for (let server of servers) {
    server.close()
  }
  servers = []
})

afterEach(() => {
  workspace.configurations.reset()
})

async function createServer(): Promise<number> {
  let port = await getFreePort()
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
      if (req.url === '/quoted_charset') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset="utf-8"' })
        res.end('你好')
      }
      if (req.url === '/extra_charset') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8; format=flowed' })
        res.end('你好')
      }
      if (req.url === '/quoted_json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset="utf-8"' })
        res.end(JSON.stringify({ text: '你好' }))
      }
      if (req.url === '/latin_charset') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=ISO-8859-1' })
        res.end(Buffer.from([0xe4, 0x6b]))
      }
      if (req.url === '/unknown_charset') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=x-unknown' })
        res.end('abc')
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
        let zipfile = path.resolve(import.meta.dirname, '../test.zip')
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
      if (req.url === '/evil_zip') {
        let zipfile = path.resolve(import.meta.dirname, '../evil.zip')
        let stat = fs.statSync(zipfile)
        res.setHeader('Content-Length', stat.size)
        res.setHeader('Content-Type', 'application/zip')
        res.writeHead(200)
        let stream = fs.createReadStream(zipfile)
        stream.pipe(res)
      }
      if (req.url === '/abs_zip') {
        let zipfile = path.resolve(import.meta.dirname, '../abs.zip')
        let stat = fs.statSync(zipfile)
        res.setHeader('Content-Length', stat.size)
        res.setHeader('Content-Type', 'application/zip')
        res.writeHead(200)
        let stream = fs.createReadStream(zipfile)
        stream.pipe(res)
      }
      if (req.url === '/tgz') {
        res.setHeader('Content-Disposition', 'attachment; filename="file.tgz"')
        res.setHeader('Content-Type', 'application/octet-stream')
        let tarfile = path.resolve(import.meta.dirname, '../test.tar.gz')
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

async function getFreePort(): Promise<number> {
  for (let i = 0; i < 100; i++) {
    let port = currentPort
    try {
      return await new Promise((resolve, reject) => {
        let server = net.createServer()
        server.once('error', reject)
        server.listen(port, () => {
          server.once('close', () => {
            currentPort = port + 1
            resolve(port)
          })
          server.close()
        })
      })
    } catch (e) {
      currentPort = port + 1
      if ((e as any).code !== 'EADDRINUSE') throw e
    }
  }
  throw new Error('no free port found')
}

describe('utils', () => {
  it('should getText', t => {
    assert.strictEqual(getText({ x: 1 }), '{"x":1}')
  })

  it('should getExtname', t => {
    let res = getExtname('attachment; x="y"')
    assert.strictEqual(res, undefined)
  })

  it('should getPort', async t => {
    assert.strictEqual(toPort(80, 'http'), 80)
    assert.strictEqual(toPort('80', 'http'), 80)
    assert.strictEqual(toPort('x', 'http'), 80)
    assert.strictEqual(toPort('', 'https'), 443)
  })

  it('should getEtag', t => {
    assert.strictEqual(getEtag({}), undefined)
    assert.strictEqual(getEtag({ etag: '"abc"' }), 'abc')
    assert.strictEqual(getEtag({ etag: 'W/"abc"' }), 'abc')
    assert.strictEqual(getEtag({ etag: 'Wabc"' }), undefined)
  })

  it('should get data type', t => {
    assert.strictEqual(getDataType(null), 'null')
    assert.strictEqual(getDataType(undefined), 'undefined')
    assert.strictEqual(getDataType('s'), 'string')
    let b = Buffer.from('abc', 'utf8')
    assert.strictEqual(getDataType(b), 'buffer')
    assert.strictEqual(getDataType({}), 'object')
    assert.strictEqual(getDataType(new Date()), 'unknown')
  })

  it('should getRequestModule', t => {
    let url = toURL('https://www.baidu.com')
    assert.notStrictEqual(getRequestModule(url), undefined)
  })

  it('should convert to URL', t => {
    assert.throws(() => { toURL('') })
    assert.throws(() => { toURL('file:///1') })
    assert.throws(() => { toURL(undefined) })
    assert.strictEqual(toURL('https://www.baidu.com').toString(), 'https://www.baidu.com/')
    let u = new URL('http://www.baidu.com')
    assert.strictEqual(toURL(u), u)
  })

  it('should report valid proxy', t => {
    let agent = getAgent(new URL('http://google.com'), { proxy: 'domain.com:1234' })
    assert.strictEqual(agent, null)

    agent = getAgent(new URL('http://google.com'), { proxy: 'ftp://domain.com:1234' })
    assert.strictEqual(agent, null)

    agent = getAgent(new URL('http://google.com'), { proxy: '' })
    assert.strictEqual(agent, null)

    agent = getAgent(new URL('http://google.com'), { proxy: 'domain.com' })
    assert.strictEqual(agent, null)

    agent = getAgent(new URL('https://google.com'), { proxy: 'https://domain.com' })
    let proxy = (agent as any).proxy
    assert.strictEqual(proxy.host, 'domain.com')
    assert.strictEqual(proxy.protocol, 'https:')
    assert.strictEqual((agent as any).connectOpts.port, 443)

    agent = getAgent(new URL('http://google.com'), { proxy: 'http://domain.com', proxyStrictSSL: true })
    proxy = (agent as any).proxy
    assert.strictEqual(proxy.host, 'domain.com')
    assert.strictEqual(proxy.protocol, 'http:')
    assert.strictEqual((agent as any).connectOpts.port, 80)

    agent = getAgent(new URL('http://google.com'), { proxy: 'https://domain.com:1234' })
    proxy = (agent as any).proxy
    assert.strictEqual(proxy.host, 'domain.com:1234')
    assert.strictEqual(proxy.hostname, 'domain.com')
    assert.strictEqual(proxy.port, '1234')
    assert.strictEqual((agent as any).connectOpts.port, 1234)

    agent = getAgent(new URL('http://google.com'), { proxy: 'http://user:pass@domain.com:1234' })
    proxy = (agent as any).proxy
    assert.strictEqual(proxy.host, 'domain.com:1234')
    assert.strictEqual(proxy.hostname, 'domain.com')
    assert.strictEqual(proxy.port, '1234')
    assert.strictEqual((agent as any).connectOpts.port, 1234)
    assert.strictEqual(proxy.username, 'user')
    assert.strictEqual(proxy.password, 'pass')
  })

  it('should getAgent from proxy', t => {
    let agent = getAgent(new URL('http://google.com'), { proxy: 'http://user:@domain.com' })
    let proxy = (agent as any).proxy
    assert.strictEqual(proxy.host, 'domain.com')
    assert.strictEqual(proxy.username, 'user')
    assert.strictEqual((agent as any).connectOpts.port, 80)
  })

  it('should getSystemProxyURI', t => {
    let url = new URL('http://www.example.com')
    let http_proxy = 'http://127.0.0.1:7070'
    assert.strictEqual(getSystemProxyURI(url, { NO_PROXY: '*', HTTP_PROXY: http_proxy }), null)
    assert.strictEqual(getSystemProxyURI(url, { no_proxy: '*', HTTP_PROXY: http_proxy }), null)
    assert.strictEqual(getSystemProxyURI(new URL('http://www.example.com:80'), {
      NO_PROXY: 'xyz:33,example.com:80',
      HTTP_PROXY: http_proxy
    }), null)
    assert.strictEqual(getSystemProxyURI(url, {
      NO_PROXY: 'baidu.com,example.com',
      HTTP_PROXY: http_proxy
    }), null)
    assert.strictEqual(getSystemProxyURI(url, { HTTP_PROXY: http_proxy }), http_proxy)
    assert.strictEqual(getSystemProxyURI(url, { http_proxy }), http_proxy)
    assert.strictEqual(getSystemProxyURI(url, {}), null)
    url = new URL('https://www.example.com')
    let https_proxy = 'https://127.0.0.1:7070'
    assert.strictEqual(getSystemProxyURI(url, { HTTPS_PROXY: https_proxy }), https_proxy)
    assert.strictEqual(getSystemProxyURI(url, { https_proxy }), https_proxy)
    assert.strictEqual(getSystemProxyURI(url, { HTTP_PROXY: http_proxy }), http_proxy)
    assert.strictEqual(getSystemProxyURI(url, { http_proxy }), http_proxy)
    assert.strictEqual(getSystemProxyURI(url, {}), null)
  })

  it('should resolve request options #1', async t => {
    let file = path.join(os.tmpdir(), `${crypto.randomUUID()}/ca`)
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, 'ca', 'utf8')
    shared.updateConfiguration('http.proxyAuthorization', 'authorization')
    shared.updateConfiguration('http.proxyCA', file)
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
    assert.strictEqual(res.path, '/?x=1')
    assert.strictEqual(Buffer.isBuffer(res.ca), true)
  })

  it('should resolve request options #2', async t => {
    let url = new URL('https://abc:123@www.example.com')
    let res = resolveRequestOptions(url, {
      user: 'user',
      data: 'data'
    })
    assert.strictEqual(res.port, 443)
    assert.strictEqual(res.path, '/')
    assert.strictEqual(res.auth, 'abc:123')
  })
})

describe('fetch', () => {

  it('should fetch json', async t => {
    let res = await fetch(`http://127.0.0.1:${port}/json`, {
      method: 'POST',
      data: 'data'
    })
    assert.deepStrictEqual(res, { result: 'succeed' })
    res = await fetch(`http://127.0.0.1:${port}/json`, { buffer: true })
    assert.strictEqual(Buffer.isBuffer(res), true)
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/bad_json`)
    }
    await assert.rejects(fn(), Error)
  })

  it('decodes quoted and trailing-parameter charsets and rejects unknown ones', async t => {
    let uncaught: Error[] = []
    let onUncaught = (err: Error): void => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)
    try {
      assert.strictEqual(await fetch(`http://127.0.0.1:${port}/quoted_charset`), '你好')
      assert.strictEqual(await fetch(`http://127.0.0.1:${port}/extra_charset`), '你好')
      assert.deepStrictEqual(await fetch(`http://127.0.0.1:${port}/quoted_json`), { text: '你好' })
      assert.strictEqual(await fetch(`http://127.0.0.1:${port}/latin_charset`), '\u00e4k')
      let fn = async () => {
        await fetch(`http://127.0.0.1:${port}/unknown_charset`)
      }
      await assert.rejects(fn(), /charset/i)
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    assert.deepStrictEqual(uncaught, [])
  })

  it('should catch error on reject or abnormal response', async t => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/reject`)
    }
    await assert.rejects(fn(), )
  })

  it('should catch abnormal close', async t => {
    let version = semver.parse(process.version)
    if (version.major >= 16) {
      let fn = async () => {
        await fetch(`http://127.0.0.1:${port}/close`)
      }
      await assert.rejects(fn(), )
      fn = async () => {
        await download(`http://127.0.0.1:${port}/close`, { dest: os.tmpdir() })
      }
      await assert.rejects(fn(), )
    }
  })

  it('should throw on 404 response', async t => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/404`)
    }
    await assert.rejects(fn(), Error)
  })

  it('should catch proxy error', async t => {
    delete process.env.NO_PROXY
    process.env.HTTP_PROXY = `http://127.0.0.1`
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/json`)
    }
    await assert.rejects(fn(), )
    delete process.env.HTTP_PROXY
  })

  it('should throw for ECONNRESET error', async t => {
    await assert.rejects(async () => {
      let obj: any = {}
      let url = new URL(`http://127.0.0.1:${port}/text`)
      let opts = resolveRequestOptions(url, {})
      let p = request(url, undefined, opts, undefined, obj)
      let err: any = new Error('ECONNRESET')
      err.code = 'ECONNRESET'
      obj.req.destroy(err)
      await p
    }, /ECONNRESET/)
  })

  it('should fetch text', async t => {
    let res = await fetch(`http://127.0.0.1:${port}/text`)
    assert.strictEqual(res, 'text')
    let fn = async () => {
      let port = await getFreePort()
      res = await fetch(`http://127.0.0.1:${port}/not_exists`, { timeout: 2000 })
    }
    await assert.rejects(fn(), )
  })

  it('should throw on timeout', async t => {
    let fn = async () => {
      await fetch(`http://127.0.0.1:${port}/slow`, { timeout: 50 })
    }
    await assert.rejects(fn(), Error)
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
    await assert.rejects(fn(), Error)
    fn = async () => {
      await download(url, Object.assign(opts, { dest: os.tmpdir() }))
    }
    await assert.rejects(fn(), Error)

    opts.agent.destroy()
  })

  it('should cancel by CancellationToken', async t => {
    let fn = async () => {
      let tokenSource = new CancellationTokenSource()
      let p = fetch(`http://127.0.0.1:${port}/slow`, { timeout: 50 }, tokenSource.token)
      await shared.wait(20)
      tokenSource.cancel()
      await p
    }
    await assert.rejects(fn(), Error)
  })
})

describe('download', () => {
  let binary_file: string
  let tempdir = path.join(os.tmpdir(), crypto.randomUUID())

  before(async () => {
    binary_file = path.join(os.tmpdir(), 'binary_file')
    if (!fs.existsSync(binary_file)) {
      let data = Buffer.alloc(100 * 1024, 0)
      await promisify(fs.writeFile)(binary_file, data)
    }
    // create binary files
  })

  it('should throw for bad option', async t => {
    let url = 'https://127.0.0.1'
    let fn = async () => {
      await download(url, { dest: 'a/b' })
    }
    await assert.rejects(fn(), Error)
    fn = async () => {
      await download(url, { dest: import.meta.filename })
    }
    await assert.rejects(fn(), /not directory/)
  })

  it('should throw on ECONNRESET', async t => {
    let obj: any = {}
    let p = download(`http://127.0.0.1:${port}/binary`, { dest: tempdir }, undefined, obj)
    let err: any = new Error('ECONNRESET')
    err.code = 'ECONNRESET'
    await assert.rejects(async () => {
      obj.req.destroy(err)
      await p
    }, Error)
  })

  it('should throw when unable to extract', async t => {
    let url = `http://127.0.0.1:${port}/text`
    let fn = async () => {
      await download(url, { dest: tempdir, extract: true })
    }
    await assert.rejects(fn(), /extract method/)
  })

  it('should throw for bad response', async t => {
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/404`, { dest: tempdir })
    }
    await assert.rejects(fn(), Error)
    fn = async () => {
      await download(`http://127.0.0.1:${port}/reject`, { dest: tempdir })
    }
    await assert.rejects(fn(), )
    fn = async () => {
      let port = await getFreePort()
      await download(`http://127.0.0.1:${port}/not_exists`, { dest: tempdir, timeout: 2000 })
    }
    await assert.rejects(fn(), )
  })

  it('should throw on timeout', async t => {
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/slow`, { dest: tempdir, timeout: 50 })
    }
    await assert.rejects(fn(), )
  })

  it('should download binary file', async t => {
    let url = `http://127.0.0.1:${port}/binary`
    let called = false
    let res = await download(url, {
      etagAlgorithm: 'md5',
      dest: tempdir, onProgress: p => {
        assert.strictEqual(typeof p, 'string')
        called = true
      }
    })
    assert.strictEqual(called, true)
    let exists = fs.existsSync(res)
    assert.strictEqual(exists, true)
  })

  it('should throw when etag check failed', async t => {
    let url = `http://127.0.0.1:${port}/binary`
    let called = false
    let fn = async () => {
      await download(url, {
        etagAlgorithm: 'sha256',
        dest: tempdir, onProgress: p => {
          assert.strictEqual(typeof p, 'string')
          called = true
        }
      })
    }
    await assert.rejects(fn(), /Etag check failed/)
  })

  it('should download zip file', async t => {
    let url = `http://127.0.0.1:${port}/zip`
    let res = await download(url, {
      dest: tempdir,
      extract: true
    })
    let file = path.join(tempdir, 'log.txt')
    let exists = fs.existsSync(file)
    assert.strictEqual(exists, true)
    res = await download(url + '?nolength=1', {
      dest: tempdir,
      extract: true
    })
    exists = fs.existsSync(file)
    assert.strictEqual(exists, true)
  })

  it('should not extract zip file outside dest', async t => {
    let dest = path.join(tempdir, 'evil')
    let url = `http://127.0.0.1:${port}/evil_zip`
    await download(url, {
      dest,
      extract: true
    })
    assert.strictEqual(fs.existsSync(path.join(tempdir, 'evil.txt')), false)
    assert.strictEqual(fs.existsSync(path.join(dest, 'evil.txt')), true)
  })

  it('should extract zip with absolute entry paths to dest', async t => {
    let dest = path.join(tempdir, 'abs')
    let url = `http://127.0.0.1:${port}/abs_zip`
    await download(url, {
      dest,
      extract: true
    })
    assert.strictEqual(fs.existsSync(path.join(dest, 'log.txt')), true)
    assert.strictEqual(fs.existsSync(path.join(dest, 'abs', 'evil.txt')), true)
  })

  it('should download tgz', async t => {
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
    assert.strictEqual(exists, true)
    opts.strip = undefined
    res = await download(url, opts)
    assert.notStrictEqual(res, undefined)
  })

  it('should cancel download by CancellationToken', async t => {
    let fn = async () => {
      let tokenSource = new CancellationTokenSource()
      let p = download(`http://127.0.0.1:${port}/slow`, { dest: tempdir }, tokenSource.token)
      await shared.wait(20)
      tokenSource.cancel()
      await p
    }
    await assert.rejects(fn(), Error)
  })

  it('should throw on agent error', async t => {
    delete process.env.NO_PROXY
    process.env.HTTP_PROXY = `http://127.0.0.1`
    let fn = async () => {
      await download(`http://127.0.0.1:${port}/json`, { dest: tempdir })
    }
    await assert.rejects(fn(), /using proxy/)
    delete process.env.HTTP_PROXY
    process.env.NO_PROXY = '*'
    fn = async () => {
      let agent = new http.Agent({ keepAlive: true })
      let p = download(`http://127.0.0.1:${port}/slow`, { dest: tempdir, timeout: 50, agent })
      await p
      agent.destroy()
    }
    await assert.rejects(fn(), /timeout/)
  })
})
