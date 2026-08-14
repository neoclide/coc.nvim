import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import * as ts from 'typescript'
import * as vsTypes from 'vscode-languageserver-types'
import { Disposable } from 'vscode-languageserver-protocol'
import { SHARED_VALUE_EXPORTS, WRAPPED_SINGLETONS } from '../../extension/facade'
import * as exportObj from '../../index'
import events from '../../events'
import type Plugin from '../../plugin'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { mock } from 'node:test'

interface TypingEnumMember {
  name: string
  value?: string | number
}

function getTypingsModuleBlock(sf: ts.SourceFile): ts.ModuleBlock | undefined {
  for (let st of sf.statements) {
    if (ts.isModuleDeclaration(st) && st.name && ts.isStringLiteral(st.name) && st.body && ts.isModuleBlock(st.body)) {
      return st.body
    }
  }
  return undefined
}

function hasValueMembers(body: ts.ModuleBlock): boolean {
  for (let st of body.statements) {
    if (ts.isVariableStatement(st) || ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) {
      return true
    }
    if (ts.isModuleDeclaration(st) && st.body && ts.isModuleBlock(st.body)) {
      if (hasValueMembers(st.body)) return true
    }
  }
  return false
}

function collectNamespaceMembers(body: ts.ModuleBlock): Set<string> {
  let names = new Set<string>()
  for (let st of body.statements) {
    if (ts.isVariableStatement(st)) {
      for (let d of st.declarationList.declarations) {
        if (d.name && ts.isIdentifier(d.name)) names.add(d.name.text)
      }
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name && ts.isIdentifier(st.name)) {
      names.add(st.name.text)
    } else if (ts.isModuleDeclaration(st) && st.name && ts.isIdentifier(st.name) && st.body && ts.isModuleBlock(st.body)) {
      if (hasValueMembers(st.body)) names.add(st.name.text)
    }
  }
  return names
}

function parseEnumMembers(node: ts.EnumDeclaration): TypingEnumMember[] {
  let members: TypingEnumMember[] = []
  let next = 0
  for (let m of node.members) {
    let name = m.name.getText()
    let value: string | number | undefined
    if (m.initializer) {
      if (ts.isNumericLiteral(m.initializer)) value = Number(m.initializer.text)
      else if (ts.isStringLiteral(m.initializer)) value = m.initializer.text
    } else {
      value = next
    }
    if (typeof value === 'number') next = value + 1
    members.push({ name, value })
  }
  return members
}

let nvim: Neovim
let plugin: Plugin
let disposables: Disposable[] = []
before(async () => {
  nvim = workspace.nvim
  plugin = getCurrentPlugin()
})

before(() => {
  // Suite-level before hooks have no per-test MockTracker; use the module
  // tracker and restore it after the suite.
  mock.method(console, 'error', () => {
    // noop
  })
})

beforeEach(() => {
  nvim.emit('notification', 'updateConfig', ['suggest.timeout', 300])
  nvim.emit('notification', 'action_not_exists', [])
})

afterEach(() => {
  disposeAll(disposables)
})

after(() => {
  mock.restoreAll()
})

describe('Plugin', () => {
  it('should check hasAction', t => {
    assert.strictEqual(plugin.hasAction('NOT_EXISTS'), false)
    assert.strictEqual(plugin.hasAction('rename'), true)
  })

  it('should throw when action exists', t => {
    assert.throws(() => {
      plugin.addAction('rename', () => {})
    }, Error)
  })
})

describe('exports', () => {
  it('should classify every runtime export in the facade lists', () => {
    let unclassified = Object.keys(exportObj).filter(k => {
      if (k === 'default') return false
      if ((WRAPPED_SINGLETONS as readonly string[]).includes(k)) return false
      if ((SHARED_VALUE_EXPORTS as readonly string[]).includes(k)) return false
      return k !== 'nvim'
    })
    assert.deepStrictEqual(
      unclassified,
      [],
      `src/index.ts export(s) missing from WRAPPED_SINGLETONS / SHARED_VALUE_EXPORTS: ${unclassified.join(', ')}`
    )
  })

  it('should exports all types from vscode-languageserver-types', t => {
    // TODO: LanguageKind added in 3.18, we didn't use this yet
    // TODO: CodeActionTag added in 3.18, but prpoposed
    const excludes = [
      'URI',
      'TextDocument',
      'LanguageKind',
      'CodeActionTag',
    ]
    let list: string[] = []
    for (let key of Object.keys(vsTypes)) {
      // 'default' is the ESM/CJS interop artifact of the coc-pkg shim, not
      // a real vscode-languageserver-types export.
      if (key === 'default') continue
      if (typeof exportObj[key] === 'undefined' && !excludes.includes(key)) {
        list.push(key)
      }
    }
    assert.strictEqual(list.length, 0)
    for (let key of ['InlineCompletionItem', 'InlineCompletionContext', 'EOL', 'ExtensionType']) {
      assert.notStrictEqual(exportObj[key], undefined)
    }
  })
})

describe('typings declarations', () => {
  let typingsPath = path.resolve(import.meta.dirname, '../../../typings/index.d.ts')
  let sf = ts.createSourceFile(typingsPath, fs.readFileSync(typingsPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let block = getTypingsModuleBlock(sf)

  it('should match runtime exports and enum values', t => {
    assert.notStrictEqual(block, undefined)
    let valueNames = new Set<string>()
    let enums = new Map<string, TypingEnumMember[]>()
    let nsMembers = new Map<string, Set<string>>()
    for (let st of block.statements) {
      if (!ts.canHaveModifiers(st) || !st.modifiers || !st.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      if (ts.isEnumDeclaration(st) && st.name && ts.isIdentifier(st.name)) {
        valueNames.add(st.name.text)
        enums.set(st.name.text, parseEnumMembers(st))
      } else if (ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st)) {
        if (st.name && ts.isIdentifier(st.name)) valueNames.add(st.name.text)
      } else if (ts.isVariableStatement(st)) {
        for (let d of st.declarationList.declarations) {
          if (d.name && ts.isIdentifier(d.name)) valueNames.add(d.name.text)
        }
      } else if (ts.isModuleDeclaration(st) && st.name && ts.isIdentifier(st.name) && st.body && ts.isModuleBlock(st.body)) {
        if (hasValueMembers(st.body)) valueNames.add(st.name.text)
        nsMembers.set(st.name.text, collectNamespaceMembers(st.body))
      }
    }
    let runtimeNames = Object.keys(exportObj).filter(k => {
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !k.startsWith('__') && k !== 'default'
    })
    let missingInTypings = runtimeNames.filter(k => !valueNames.has(k))
    assert.deepStrictEqual(missingInTypings, [])
    let missingAtRuntime = [...valueNames].filter(n => !Object.prototype.hasOwnProperty.call(exportObj, n))
    assert.deepStrictEqual(missingAtRuntime, [])
    for (let [name, members] of enums) {
      let runtimeEnum = exportObj[name]
      if (typeof runtimeEnum !== 'object' || runtimeEnum === null) continue
      let declaredMembers = new Set([...members.map(m => m.name), ...(nsMembers.get(name) || [])])
      for (let m of members) {
        assert.ok(m.name in runtimeEnum, `${name}.${m.name} missing at runtime`)
        if (m.value !== undefined) {
          assert.strictEqual(runtimeEnum[m.name], m.value)
        }
      }
      for (let key of Object.keys(runtimeEnum)) {
        if (/^\d+$/.test(key)) continue
        if (typeof runtimeEnum[key] === 'function') continue
        assert.strictEqual(declaredMembers.has(key), true)
      }
    }
    // namespace value members should exist on the runtime object
    for (let [name, members] of nsMembers) {
      if (!Object.prototype.hasOwnProperty.call(exportObj, name)) continue
      let runtimeNs = exportObj[name]
      if (typeof runtimeNs !== 'object' || runtimeNs === null) continue
      for (let member of members) {
        assert.ok(member in runtimeNs, `${name}.${member} missing at runtime`)
      }
    }
  })
})

describe('help tags', () => {
  it('should return jumpable', async t => {
    let jumpable = await getCurrentPlugin().cocAction('snippetCheck', false, true)
    assert.strictEqual(jumpable, false)
  })

  it('should show CocInfo', async t => {
    await shared.doAction('showInfo')
    let line = await nvim.line
    assert.match(line, new RegExp('version'))
  })

  it('should ensure current document created', async t => {
    await nvim.command('tabe tmp.js')
    let res = await getCurrentPlugin().cocAction('ensureDocument')
    assert.strictEqual(res, true)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let doc = workspace.getDocument(bufnr)
    assert.notStrictEqual(doc, undefined)
  })

  it('should get related information', async t => {
    let res = await getCurrentPlugin().cocAction('diagnosticRelatedInformation')
    assert.deepStrictEqual(res, [])
  })
})

describe('notifications', () => {
  it('should notification before plugin ready', t => {
    nvim.emit('notification', 'VimEnter', [''])
    let timeout = workspace.getConfiguration('suggest').get('timeout')
    assert.strictEqual(timeout, 300)
  })

  it('should do Log', t => {
    nvim.emit('notification', 'Log', [])
    nvim.emit('notification', 'redraw', [])
  })

  it('should do notifications', async t => {
    nvim.emit('notification', 'listNames', [])
    let called = false
    t.mock.method(console, 'error', () => {
      called = true
    })
    nvim.emit('notification', 'name_not_exists', [])
    nvim.emit('notification', 'MenuInput', [])
    await shared.waitValue(() => {
      return called
    }, true)
  })
})

describe('request', () => {
  it('should get results', async t => {
    let result
    nvim.emit('request', 'listNames', [], {
      send: res => {
        result = res
      }
    })
    await shared.waitValue(() => {
      return Array.isArray(result)
    }, true)
  })

  it('should return error when plugin not ready', async t => {
    let plugin = getCurrentPlugin()
    Object.assign(plugin, { ready: false })
    let isErr
    nvim.emit('request', 'listNames', [], {
      send: (_res, isError) => {
        isErr = isError
      }
    })
    await shared.waitValue(() => {
      return isErr
    }, true)
    Object.assign(plugin, { ready: true })
  })

  it('should not throw when plugin method not found', async t => {
    let err
    nvim.emit('request', 'NotExists', [], {
      send: res => {
        err = res
      }
    })
    await shared.waitValue(() => {
      return typeof err === 'string'
    }, true)
  })

  it('should echo error instead of throw for autocmds request', async t => {
    let called = false
    let responded = false
    let fire = events.fire.bind(events)
    t.mock.method(events, 'fire', (event, args) => {
      return event === 'CursorHold' ? Promise.reject(new Error('my error')) : fire(event, args)
    })
    t.mock.method(nvim, 'echoError', () => {
      called = true
    })
    try {
      nvim.emit('request', 'CocAutocmd', ['CursorHold', 1, [1, 1]], {
        send: () => {
          responded = true
        }
      })
      await shared.waitValue(() => called && responded, true)
    } finally {
      t.mock.restoreAll()
    }
  })
})

describe('attach', () => {
  it('should not throw on event handler error', async t => {
    disposables.push(events.on('CursorHold', () => {
      throw new Error('error')
    }))
    let called = false
    nvim.emit('request', 'CocAutocmd', ['CursorHold'], {
      send: () => {
        called = true
      }
    })
    await shared.waitValue(() => {
      return called
    }, true)
  })
})
