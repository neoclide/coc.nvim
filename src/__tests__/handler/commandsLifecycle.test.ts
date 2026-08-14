import crypto from 'crypto'
import commands from '../../commands'

afterEach(editorReset)

describe('commands manager lifecycle', () => {
  it('should list, execute and dispose commands', () => {
    let id = `test.dispose-${crypto.randomUUID().slice(0, 8)}`
    let disposable = commands.registerCommand(id, () => {
      throw new Error('raw boom')
    })
    assert.strictEqual(commands.has(id), true)
    assert.ok(commands.commandList.some(o => o.id === id))
    // Commands registered directly (not through an extension facade) keep the
    // original error unchanged.
    assert.throws(() => commands.executeCommand(id), /raw boom/)
    disposable.dispose()
    assert.strictEqual(commands.has(id), false)
    // Disposing the whole manager clears remaining registrations.
    let id2 = `${id}.2`
    commands.registerCommand(id2, () => 'ok')
    commands.dispose()
    assert.strictEqual(commands.has(id2), false)
    assert.strictEqual(commands.commandList.length, 0)
  })
})
