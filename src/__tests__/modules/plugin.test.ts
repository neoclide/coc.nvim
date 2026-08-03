import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import * as ts from 'typescript'
import * as vsTypes from 'vscode-languageserver-types'
import * as exportObj from '../../index'
import Plugin from '../../plugin'
import workspace from '../../workspace'
import helper from '../helper'

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
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  plugin = helper.plugin
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('Plugin', () => {
  it('should check hasAction', () => {
    expect(plugin.hasAction('NOT_EXISTS')).toBe(false)
    expect(plugin.hasAction('rename')).toBe(true)
  })

  it('should throw when action exists', () => {
    expect(() => {
      plugin.addAction('rename', () => {})
    }).toThrow(Error)
  })
})

describe('exports', () => {
  it('should exports all types from vscode-languageserver-types', () => {
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
      if (typeof exportObj[key] === 'undefined' && !excludes.includes(key)) {
        list.push(key)
      }
    }
    expect(list.length).toBe(0)
    for (let key of ['InlineCompletionItem', 'InlineCompletionContext', 'EOL', 'ExtensionType']) {
      expect(exportObj[key]).toBeDefined()
    }
  })
})

describe('typings declarations', () => {
  let typingsPath = path.resolve(__dirname, '../../../typings/index.d.ts')
  let sf = ts.createSourceFile(typingsPath, fs.readFileSync(typingsPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let block = getTypingsModuleBlock(sf)

  it('should match runtime exports and enum values', () => {
    expect(block).toBeDefined()
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
    // runtime exports that typings intentionally keep type-only
    let typeOnlyExports = new Set(['Mru', 'FloatFactory'])
    let runtimeNames = Object.keys(exportObj).filter(k => {
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !k.startsWith('__') && k !== 'default'
    })
    let missingInTypings = runtimeNames.filter(k => !valueNames.has(k) && !typeOnlyExports.has(k))
    expect(missingInTypings).toEqual([])
    let missingAtRuntime = [...valueNames].filter(n => !Object.prototype.hasOwnProperty.call(exportObj, n))
    expect(missingAtRuntime).toEqual([])
    for (let [name, members] of enums) {
      let runtimeEnum = exportObj[name]
      if (typeof runtimeEnum !== 'object' || runtimeEnum === null) continue
      let declaredMembers = new Set([...members.map(m => m.name), ...(nsMembers.get(name) || [])])
      for (let m of members) {
        expect(m.name in runtimeEnum, `${name}.${m.name} missing at runtime`).toBe(true)
        if (m.value !== undefined) {
          expect(runtimeEnum[m.name]).toBe(m.value)
        }
      }
      for (let key of Object.keys(runtimeEnum)) {
        if (/^\d+$/.test(key)) continue
        if (typeof runtimeEnum[key] === 'function') continue
        expect(declaredMembers.has(key)).toBe(true)
      }
    }
    // namespace value members should exist on the runtime object
    for (let [name, members] of nsMembers) {
      if (!Object.prototype.hasOwnProperty.call(exportObj, name)) continue
      let runtimeNs = exportObj[name]
      if (typeof runtimeNs !== 'object' || runtimeNs === null) continue
      for (let member of members) {
        expect(member in runtimeNs, `${name}.${member} missing at runtime`).toBe(true)
      }
    }
  })
})

describe('help tags', () => {
  it('should return jumpable', async () => {
    let jumpable = await helper.plugin.cocAction('snippetCheck', false, true)
    expect(jumpable).toBe(false)
  })

  it('should show CocInfo', async () => {
    await helper.doAction('showInfo')
    let line = await nvim.line
    expect(line).toMatch('version')
  })

  it('should ensure current document created', async () => {
    await nvim.command('tabe tmp.js')
    let res = await helper.plugin.cocAction('ensureDocument')
    expect(res).toBe(true)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let doc = workspace.getDocument(bufnr)
    expect(doc).toBeDefined()
  })

  it('should get related information', async () => {
    let res = await helper.plugin.cocAction('diagnosticRelatedInformation')
    expect(res).toEqual([])
  })
})
