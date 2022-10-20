'use strict'
import decompressResponse from 'decompress-response'
import { http, https } from 'follow-redirects'
import fs from 'fs'
import createHttpProxyAgent, { HttpProxyAgent } from 'http-proxy-agent'
import createHttpsProxyAgent, { HttpsProxyAgent } from 'https-proxy-agent'
import { ParsedUrlQueryInput, stringify } from 'querystring'
import { Readable } from 'stream'
import { URL } from 'url'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { CancellationError, isCancellationError } from '../util/errors'
import { objectLiteral } from '../util/is'
import workspace from '../workspace'
const logger = require('../util/logger')('model-fetch')

export type ResponseResult = string | Buffer | { [name: string]: any }

export interface ProxyOptions {
  proxy: string
  proxyStrictSSL?: boolean
  proxyAuthorization?: string | null
  proxyCA?: string | null
}

export interface FetchOptions {
  /**
   * Default to 'GET'
   */
  method?: string
  /**
   * Default no timeout
   */
  timeout?: number
  /**
   * Always return buffer instead of parsed response.
   */
  buffer?: boolean
  /**
   * - 'string' for text response content
   * - 'object' for json response content
   * - 'buffer' for response not text or json
   */
  data?: string | { [key: string]: any } | Buffer
  /**
   * Plain object added as query of url
   */
  query?: ParsedUrlQueryInput
  headers?: any
  /**
   * User for http basic auth, should use with password
   */
  user?: string
  /**
   * Password for http basic auth, should use with user
   */
  password?: string
}

function toText(text: string | undefined | null): string {
  return text ? text : ''
}

export function getRequestModule(url: URL): typeof http | typeof https {
  return url.protocol === 'https:' ? https : http
}

export function getText(data: any): string | Buffer {
  if (typeof data === 'string' || Buffer.isBuffer(data)) return data
  return JSON.stringify(data)
}

export function toURL(urlInput: string | URL): URL {
  if (urlInput instanceof URL) return urlInput
  let url = new URL(urlInput)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`Not valid protocol with ${urlInput}, should be http: or https:`)
  return url
}

export function getDataType(data: any): string {
  if (data === null) return 'null'
  if (data === undefined) return 'undefined'
  if (typeof data == 'string') return 'string'
  if (Buffer.isBuffer(data)) return 'buffer'
  if (Array.isArray(data) || objectLiteral(data)) return 'object'
  return 'unknown'
}

export function getSystemProxyURI(endpoint: URL, env = process.env): string | null {
  let noProxy = env.NO_PROXY ?? env.no_proxy
  if (noProxy === '*') {
    return null
  }
  if (noProxy) {
    // canonicalize the hostname, so that 'oogle.com' won't match 'google.com'
    const hostname = endpoint.hostname.replace(/^\.*/, '.').toLowerCase()
    const port = endpoint.port || endpoint.protocol.startsWith('https') ? '443' : '80'
    const noProxyList = noProxy.split(',')
    for (let i = 0, len = noProxyList.length; i < len; i++) {
      let noProxyItem = noProxyList[i].trim().toLowerCase()
      // no_proxy can be granular at the port level, which complicates things a bit.
      if (noProxyItem.includes(':')) {
        let noProxyItemParts = noProxyItem.split(':', 2)
        let noProxyHost = noProxyItemParts[0].replace(/^\.*/, '.')
        let noProxyPort = noProxyItemParts[1]
        if (port === noProxyPort && hostname.endsWith(noProxyHost)) {
          return null
        }
      } else {
        noProxyItem = noProxyItem.replace(/^\.*/, '.')
        if (hostname.endsWith(noProxyItem)) {
          return null
        }
      }
    }
  }
  let proxyUri: string | null
  if (endpoint.protocol === 'http:') {
    proxyUri = env.HTTP_PROXY || env.http_proxy || null
  } else {
    proxyUri = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null
  }
  return proxyUri
}

export function getAgent(endpoint: URL, options: ProxyOptions): HttpsProxyAgent | HttpProxyAgent {
  let proxy = options.proxy || getSystemProxyURI(endpoint)
  if (proxy) {
    let proxyURL: URL
    try {
      proxyURL = new URL(proxy)
      if (!/^https?:$/.test(proxyURL.protocol)) return null
    } catch (e) {
      return null
    }
    let opts = {
      host: proxyURL.hostname,
      port: proxyURL.port ? Number(proxyURL.port) : (proxyURL.protocol === 'https:' ? 443 : 80),
      auth: proxyURL.username ? `${proxyURL.username}:${toText(proxyURL.password)}` : undefined,
      rejectUnauthorized: typeof options.proxyStrictSSL === 'boolean' ? options.proxyStrictSSL : true
    }
    logger.info(`Using proxy ${proxy} from ${options.proxy ? 'configuration' : 'system environment'} for ${endpoint.hostname}:`)
    return endpoint.protocol === 'http:' ? createHttpProxyAgent(opts) : createHttpsProxyAgent(opts)
  }
  return null
}

export function resolveRequestOptions(url: URL, options: FetchOptions): any {
  let config = workspace.getConfiguration('http', null)
  let dataType = getDataType(options.data)
  let proxyOptions: ProxyOptions = {
    proxy: config.get<string>('proxy', ''),
    proxyStrictSSL: config.get<boolean>('proxyStrictSSL', true),
    proxyAuthorization: config.get<string | null>('proxyAuthorization', null),
    proxyCA: config.get<string | null>('proxyCA', null)
  }
  if (options.query && !url.search) {
    url.search = `?${stringify(options.query)}`
  }
  let agent = getAgent(url, proxyOptions)
  let opts: any = {
    method: options.method ?? 'GET',
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    agent,
    rejectUnauthorized: proxyOptions.proxyStrictSSL,
    maxRedirects: 3,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      'Accept-Encoding': 'gzip, deflate',
      ...(options.headers ?? {})
    }
  }
  if (dataType == 'object') {
    opts.headers['Content-Type'] = 'application/json'
  } else if (dataType == 'string') {
    opts.headers['Content-Type'] = 'text/plain'
  }
  if (proxyOptions.proxyAuthorization) opts.headers['Proxy-Authorization'] = proxyOptions.proxyAuthorization
  if (proxyOptions.proxyCA) opts.ca = fs.readFileSync(proxyOptions.proxyCA)
  if (options.user) opts.auth = options.user + ':' + (toText(options.password))
  if (url.username) opts.auth = url.username + ':' + (toText(url.password))
  if (options.timeout) opts.timeout = options.timeout
  if (options.buffer) opts.buffer = true
  return opts
}

export function request(url: URL, data: any, opts: any, token?: CancellationToken): Promise<ResponseResult> {
  let mod = getRequestModule(url)
  return new Promise<ResponseResult>((resolve, reject) => {
    if (token) {
      let disposable = token.onCancellationRequested(() => {
        disposable.dispose()
        req.destroy(new CancellationError())
      })
    }
    let timer: NodeJS.Timer
    const req = mod.request(opts, res => {
      let readable: Readable = res
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = res.headers
        let chunks: Buffer[] = []
        let contentType: string = headers['content-type'] || ''
        readable = decompressResponse(res)
        readable.on('data', chunk => {
          chunks.push(chunk)
        })
        readable.on('end', () => {
          clearTimeout(timer)
          let buf = Buffer.concat(chunks)
          if (!opts.buffer && (contentType.startsWith('application/json') || contentType.startsWith('text/'))) {
            let ms = contentType.match(/charset=(\S+)/)
            let encoding = ms ? ms[1] : 'utf8'
            let rawData = buf.toString(encoding as BufferEncoding)
            if (!contentType.includes('application/json')) {
              resolve(rawData)
            } else {
              try {
                const parsedData = JSON.parse(rawData)
                resolve(parsedData)
              } catch (e) {
                reject(new Error(`Parse response error: ${e}`))
              }
            }
          } else {
            resolve(buf)
          }
        })
        readable.on('error', err => {
          reject(new Error(`Connection error to ${url}: ${err.message}`))
        })
      } else {
        reject(new Error(`Bad response from ${url}: ${res.statusCode}`))
      }
    })
    req.on('error', e => {
      // Possible succeed proxy request with ECONNRESET error on node > 14
      if (opts.agent && e['code'] == 'ECONNRESET') {
        timer = setTimeout(() => {
          reject(e)
        }, 500)
      } else {
        reject(e)
      }
    })
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${opts.timeout}ms`))
    })
    if (data) req.write(getText(data))
    if (opts.timeout) req.setTimeout(opts.timeout)
    req.end()
  })
}

/**
 * Send request to server for response, supports:
 *
 * - Send json data and parse json response.
 * - Throw error for failed response statusCode.
 * - Timeout support (no timeout by default).
 * - Send buffer (as data) and receive data (as response).
 * - Proxy support from user configuration & environment.
 * - Redirect support, limited to 3.
 * - Support of gzip & deflate response content.
 */
export default function fetch(urlInput: string | URL, options: FetchOptions = {}, token?: CancellationToken): Promise<ResponseResult> {
  let url = toURL(urlInput)
  let opts = resolveRequestOptions(url, options)
  return request(url, options.data, opts, token).catch(err => {
    if (!isCancellationError(err)) logger.error(`Fetch error for ${url}:`, opts, err)
    if (opts.agent && opts.agent.proxy) {
      let { proxy } = opts.agent
      throw new Error(`Request failed using proxy ${proxy.host}: ${err.message}`)
    } else {
      throw err
    }
  })
}
