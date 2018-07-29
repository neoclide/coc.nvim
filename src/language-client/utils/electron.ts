/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import cp from 'child_process'
import net from 'net'
import os from 'os'
import path from 'path'
import workspace from '../../workspace'

export interface IForkOpts {
  cwd?: string
  env?: any
  encoding?: string
  execArgv?: string[]
}

function makeRandomHexString(length: number): string {
  let chars = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '6',
    '7',
    '8',
    '9',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f'
  ]
  let result = ''
  for (let i = 0; i < length; i++) {
    let idx = Math.floor(chars.length * Math.random())
    result += chars[idx]
  }
  return result
}

function generatePipeName(): string {
  let randomName = 'coc-lang-' + makeRandomHexString(40)
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\' + randomName + '-sock'
  }

  // Mac/Unix: use socket file
  return path.join(os.tmpdir(), randomName + '.sock')
}

function generatePatchedEnv(
  env: any,
  stdInPipeName: string,
  stdOutPipeName: string
): any {
  // Set the two unique pipe names and the electron flag as process env

  let newEnv: any = Object.assign({}, env)
  newEnv['STDIN_PIPE_NAME'] = stdInPipeName // tslint:disable-line
  newEnv['STDOUT_PIPE_NAME'] = stdOutPipeName // tslint:disable-line
  return newEnv
}

export function fork(
  modulePath: string,
  args: string[],
  options: IForkOpts,
  callback: (error: any, cp: cp.ChildProcess | undefined) => void
): void {
  let callbackCalled = false
  let resolve = (result: cp.ChildProcess) => {
    if (callbackCalled) {
      return
    }
    callbackCalled = true
    callback(undefined, result)
  }
  let reject = (err: any) => {
    if (callbackCalled) {
      return
    }
    callbackCalled = true
    callback(err, undefined)
  }

  // Generate two unique pipe names
  let stdInPipeName = generatePipeName()
  let stdOutPipeName = generatePipeName()

  let newEnv = generatePatchedEnv(
    options.env || process.env,
    stdInPipeName,
    stdOutPipeName
  )

  let childProcess: cp.ChildProcess

  // Begin listening to stdout pipe
  let stdOutServer = net.createServer(stdOutStream => {
    // The child process will write exactly one chunk with content `ready` when it has installed a listener to the stdin pipe

    stdOutStream.once('data', (_chunk: Buffer) => {
      // The child process is sending me the `ready` chunk, time to connect to the stdin pipe
      childProcess.stdin = net.connect(stdInPipeName) as any

      // From now on the childProcess.stdout is available for reading
      childProcess.stdout = stdOutStream

      resolve(childProcess)
    })
  })
  stdOutServer.listen(stdOutPipeName)

  let serverClosed = false
  let closeServer = () => {
    if (serverClosed) {
      return
    }

    serverClosed = true
    process.removeListener('exit', closeServer)
    stdOutServer.close()
  }

  // Create the process
  let bootstrapperPath = path.join(workspace.pluginRoot, 'bin/lspForkStart')
  childProcess = cp.fork(bootstrapperPath, [modulePath].concat(args), {
    silent: true,
    cwd: options.cwd,
    env: newEnv,
    execArgv: options.execArgv
  } as any)

  childProcess.once('error', (err: Error) => {
    closeServer()
    reject(err)
  })

  childProcess.once('exit', (err: Error) => {
    closeServer()
    reject(err)
  })

  // On exit still close server
  process.once('exit', closeServer)
}
