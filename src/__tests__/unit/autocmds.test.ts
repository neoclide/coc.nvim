import Autocmds, { AutocmdItem } from '../../core/autocmds'
import { getExtensionId, setExtensionId } from '../../util/extensionId'
import { wait } from '../../util'

function fakeNvim() {
  let commands: string[] = []
  let created: { events: string[]; opts: any }[] = []
  return {
    commands,
    created,
    command(cmd: string): void {
      commands.push(cmd)
    },
    createAutocmd(events: string[], opts: any): void {
      created.push({ events, opts })
    },
    pauseNotification(): void {},
    resumeNotification(): void {}
  }
}

describe('autocmds', () => {
  it('should coalesce rebuilds of the shared autocmd group', async () => {
    let nvim = fakeNvim()
    let autocmds = new Autocmds()
    autocmds.attach(nvim as any)
    let d1 = autocmds.registerAutocmd({ event: 'CursorMoved', callback: () => {} } as any)
    let d2 = autocmds.registerAutocmd({ event: 'BufEnter', callback: () => {} } as any)
    d1.dispose()
    d2.dispose()
    await wait(20)
    assert.strictEqual(nvim.commands.filter(cmd => cmd.includes('autocmd!')).length, 1)
    assert.strictEqual(autocmds.autocmds.size, 0)
  })

  it('should skip the rebuild when nvim is not attached', async () => {
    let autocmds = new Autocmds()
    autocmds.autocmds.set(1, new AutocmdItem(1, {
      event: 'CursorMoved',
      callback: () => {},
      stack: 'Error\n    at repl:1:1\n    at /tmp/plugin/index.js:1:1'
    } as any))
    autocmds.removeExtensionAutocmds('coc.nvim')
    await wait(20)
    assert.strictEqual(autocmds.autocmds.size, 0)
  })

  it('should attribute autocmd errors to the owning extension', async () => {
    let autocmds = new Autocmds()
    let option = {
      event: 'CursorHold',
      callback: () => {
        throw new Error('boom')
      },
      stack: 'Error\n    at repl:1:1\n    at /tmp/plugin/index.js:1:1'
    } as any
    setExtensionId(option, 'plugin-a')
    assert.strictEqual(getExtensionId(option), 'plugin-a')
    autocmds.autocmds.set(1, new AutocmdItem(1, option))
    await autocmds.doAutocmd(1, [])
    assert.strictEqual(autocmds.autocmds.size, 1)
  })

  it('should log autocmd errors without extension attribution', async () => {
    let autocmds = new Autocmds()
    let option = {
      event: 'CursorHold',
      callback: () => {
        throw new Error('boom')
      },
      stack: 'Error\n    at repl:1:1\n    at /tmp/plugin/index.js:1:1'
    } as any
    autocmds.autocmds.set(1, new AutocmdItem(1, option))
    await autocmds.doAutocmd(1, [])
    assert.strictEqual(autocmds.autocmds.size, 1)
  })
})
