import { Neovim } from '@chemzqm/neovim'
import workspace from '../../workspace'
import languages from '../../languages'
import helper from '../helper'
import { disposeAll } from '../../util'
import { Disposable, TextEdit, Position } from 'vscode-languageserver-protocol'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  let { configurations } = workspace
  configurations.updateUserConfig({ 'coc.preferences.formatOnType': true })
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('formatOnType', () => {
  it('should does format on type', async () => {
    disposables.push(languages.registerOnTypeFormattingEditProvider(['text'], {
      provideOnTypeFormattingEdits: () => {
        return [TextEdit.insert(Position.create(0, 0), '  ')]
      }
    }, ['|']))
    await helper.edit()
    await nvim.command('setf text')
    await nvim.input('i|')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('  |')
    let cursor = await workspace.getCursorPosition()
    expect(cursor).toEqual({ line: 0, character: 3 })
  })

  it('should adjust cursor after format on type', async () => {
    disposables.push(languages.registerOnTypeFormattingEditProvider(['text'], {
      provideOnTypeFormattingEdits: () => {
        return [
          TextEdit.insert(Position.create(0, 0), '  '),
          TextEdit.insert(Position.create(0, 2), 'end')
        ]
      }
    }, ['|']))
    await helper.edit()
    await nvim.command('setf text')
    await nvim.setLine('"')
    await nvim.input('i|')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('  |"end')
    let cursor = await workspace.getCursorPosition()
    expect(cursor).toEqual({ line: 0, character: 3 })
  })
})
