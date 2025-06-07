import type { Disposable, MessageReader, MessageSignature, MessageWriter } from 'vscode-languageserver-protocol'
import { PipeTransport, SocketMessageReader, SocketMessageWriter, SocketTransport } from 'vscode-languageserver-protocol/node'
import * as Is from '../../util/is'
import { inspect, net } from '../../util/node'
import { ResponseError } from '../../util/protocol'

export function getLocale(): string {
  const lang = process.env.LANG
  if (!lang) return 'en'
  return lang.split('.')[0]
}

export function toMethod(type: string | MessageSignature): string {
  return Is.string(type) ? type : type.method
}

export function currentTimeStamp(): string {
  return new Date().toLocaleTimeString()
}

export function getTracePrefix(data: any): string {
  if (data.isLSPMessage && data.type) {
    return `[LSP - ${currentTimeStamp()}] `
  }
  return `[Trace - ${currentTimeStamp()}] `
}

export function fixType<T extends string | { method: string, numberOfParams?: number }>(type: T, params: any[]): T {
  if (typeof type === 'string' || typeof type.numberOfParams === 'number') return type
  let len = params.length
  Object.defineProperty(type, 'numberOfParams', {
    get: () => len
  })
  return type
}

export function data2String(data: any, color = false): string {
  if (data instanceof ResponseError) {
    const responseError = data as ResponseError<any>
    return `  Message: ${responseError.message}\n  Code: ${responseError.code
      } ${responseError.data ? '\n' + responseError.data.toString() : ''}`
  }
  if (data instanceof Error) {
    if (Is.string(data.stack)) {
      return data.stack
    }
    return (data as Error).message
  }
  if (Is.string(data)) {
    return data
  }
  return inspect(data, false, null, color)
}

export function parseTraceData(data: any): string {
  if (typeof data !== 'string') return data2String(data)
  let prefixes = ['Params: ', 'Result: ']
  for (let prefix of prefixes) {
    if (data.startsWith(prefix)) {
      try {
        let obj = JSON.parse(data.slice(prefix.length))
        return prefix + data2String(obj, true)
      } catch (_e) {
        // ignore
        return data
      }
    }
  }
  return data
}

type MessageBufferEncoding = 'ascii' | 'utf-8'

export function createClientPipeTransport(pipeName: string, encoding: MessageBufferEncoding = 'utf-8'): Promise<PipeTransport & Disposable> {
  let connectResolve: (value: [MessageReader, MessageWriter]) => void
  const connected = new Promise<[MessageReader, MessageWriter]>((resolve, _reject) => {
    connectResolve = resolve
  })
  return new Promise<PipeTransport & Disposable>((resolve, reject) => {
    const server = net.createServer(socket => {
      server.close()
      connectResolve([
        new SocketMessageReader(socket, encoding),
        new SocketMessageWriter(socket, encoding)
      ])
    })
    server.on('error', reject)
    server.listen(pipeName, () => {
      server.removeListener('error', reject)
      resolve({
        onConnected: () => { return connected },
        dispose: () => {
          server.close()
        }
      })
    })
  })
}

export function createClientSocketTransport(port: number, encoding: MessageBufferEncoding = 'utf-8'): Promise<SocketTransport & Disposable> {
  let connectResolve: (value: [MessageReader, MessageWriter]) => void
  const connected = new Promise<[MessageReader, MessageWriter]>((resolve, _reject) => {
    connectResolve = resolve
  })
  return new Promise<SocketTransport & Disposable>((resolve, reject) => {
    const server = net.createServer(socket => {
      server.close()
      connectResolve([
        new SocketMessageReader(socket, encoding),
        new SocketMessageWriter(socket, encoding)
      ])
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve({
        onConnected: () => { return connected },
        dispose: () => {
          server.close()
        }
      })
    })
  })
}
