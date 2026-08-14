import commandsManager from '../../commands'
import { setExtensionId } from '../../util/extensionId'

function uniqueId(): string {
  return `attr-${crypto.randomUUID().slice(0, 8)}`
}

describe('extension callback attribution', () => {
  it('should prefix extension id on sync command error', () => {
    let id = uniqueId()
    let impl = () => {
      throw new Error('boom')
    }
    setExtensionId(impl, 'coc-attr')
    commandsManager.registerCommand(id, impl)
    try {
      assert.throws(() => commandsManager.executeCommand(id), /\[extension: coc-attr\] boom/)
    } finally {
      commandsManager.unregister(id)
    }
  })

  it('should prefix extension id on async command rejection', async () => {
    let id = uniqueId()
    let impl = async () => {
      throw new Error('async boom')
    }
    setExtensionId(impl, 'coc-attr')
    commandsManager.registerCommand(id, impl)
    try {
      await assert.rejects(() => commandsManager.executeCommand(id), /\[extension: coc-attr\] async boom/)
    } finally {
      commandsManager.unregister(id)
    }
  })

  it('should preserve a frozen command error as cause', () => {
    let id = uniqueId()
    let original = new Error('frozen boom')
    Object.freeze(original)
    let impl = () => {
      throw original
    }
    setExtensionId(impl, 'coc-attr')
    commandsManager.registerCommand(id, impl)
    try {
      assert.throws(() => commandsManager.executeCommand(id), err => {
        assert.match((err as Error).message, /\[extension: coc-attr\] frozen boom/)
        assert.strictEqual((err as Error & { cause?: unknown }).cause, original)
        return true
      })
    } finally {
      commandsManager.unregister(id)
    }
  })

  it('should not prefix errors of untagged commands', () => {
    let id = uniqueId()
    commandsManager.registerCommand(id, () => {
      throw new Error('plain boom')
    })
    try {
      assert.throws(() => commandsManager.executeCommand(id), /plain boom/)
      assert.throws(() => commandsManager.executeCommand(id), err => {
        assert.ok(!String((err as Error).message).includes('[extension:'))
        return true
      })
    } finally {
      commandsManager.unregister(id)
    }
  })

  it('should attribute errors from Command objects registered via register', () => {
    let id = uniqueId()
    let command = {
      id,
      execute() {
        throw new Error('command object boom')
      }
    }
    setExtensionId(command, 'coc-attr')
    commandsManager.register(command, false)
    try {
      assert.throws(() => commandsManager.executeCommand(id), /\[extension: coc-attr\] command object boom/)
    } finally {
      commandsManager.unregister(id)
    }
  })

})
