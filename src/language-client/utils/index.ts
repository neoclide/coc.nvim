import type { Disposable, MessageReader, MessageSignature, MessageWriter } from 'vscode-languageserver-protocol'
import { NotificationType, NotificationType0, NotificationType1, NotificationType2, NotificationType3, NotificationType4, NotificationType5, NotificationType6, NotificationType7, NotificationType8, NotificationType9, ParameterStructures, PipeTransport, RequestType, RequestType0, RequestType1, RequestType2, RequestType3, RequestType4, RequestType5, RequestType6, RequestType7, RequestType8, RequestType9, SocketMessageReader, SocketMessageWriter, SocketTransport } from 'vscode-languageserver-protocol/node'
import * as Is from '../../util/is'
import { inspect, net } from '../../util/node'
import { ResponseError } from '../../util/protocol'

const requestTypes = [
  RequestType,
  RequestType0,
]

const notificationTypes = [
  NotificationType,
  NotificationType0,
]

export function isValidRequestType(type: any): type is string | MessageSignature {
  if (typeof type == 'string') return true
  for (let clz of requestTypes) {
    if (type instanceof clz) {
      return true
    }
  }
  return false
}

export function isValidNotificationType(type: any): type is string | MessageSignature {
  if (typeof type == 'string') return true
  for (let clz of notificationTypes) {
    if (type instanceof clz) {
      return true
    }
  }
  return false
}

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

export function getParameterStructures(kind: string): ParameterStructures {
  switch (kind) {
    case 'auto':
      return ParameterStructures.auto
    case 'byPosition':
      return ParameterStructures.byPosition
    case 'byName':
      return ParameterStructures.byName
    default:
      return ParameterStructures.auto
  }
}

// The extension may use old version vscode-languageserver-protocol, and vscode-json-rpc checks the instanceof
export function fixRequestType(type: { method: string, numberOfParams?: number } | string, params: any[]): MessageSignature | string {
  if (isValidRequestType(type)) return type
  let n = typeof type.numberOfParams === 'number' ? type.numberOfParams : params.length
  switch (n) {
    case 0:
      return new RequestType0(type.method)
    case 1:
      if (type['parameterStructures'] != null) {
        return new RequestType1(type.method, getParameterStructures(type['parameterStructures'].toString()))
      }
      return new RequestType1(type.method)
    case 2:
      return new RequestType2(type.method)
    case 3:
      return new RequestType3(type.method)
    case 4:
      return new RequestType4(type.method)
    case 5:
      return new RequestType5(type.method)
    case 6:
      return new RequestType6(type.method)
    case 7:
      return new RequestType7(type.method)
    case 8:
      return new RequestType8(type.method)
    case 9:
      return new RequestType9(type.method)
    default:
      return new RequestType(type.method)
  }
}

// The extension may use old version vscode-languageserver-protocol, and vscode-json-rpc checks the instanceof
export function fixNotificationType(type: { method: string, numberOfParams?: number } | string, params: any[]): MessageSignature | string {
  if (isValidNotificationType(type)) return type
  let n = typeof type.numberOfParams === 'number' ? type.numberOfParams : params.length
  switch (n) {
    case 0:
      return new NotificationType0(type.method)
    case 1:
      if (type['parameterStructures'] != null) {
        return new NotificationType1(type.method, getParameterStructures(type['parameterStructures'].toString()))
      }
      return new NotificationType1(type.method)
    case 2:
      return new NotificationType2(type.method)
    case 3:
      return new NotificationType3(type.method)
    case 4:
      return new NotificationType4(type.method)
    case 5:
      return new NotificationType5(type.method)
    case 6:
      return new NotificationType6(type.method)
    case 7:
      return new NotificationType7(type.method)
    case 8:
      return new NotificationType8(type.method)
    case 9:
      return new NotificationType9(type.method)
    default:
      return new NotificationType(type.method)
  }
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
