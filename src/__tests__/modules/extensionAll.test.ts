import os from 'os'
import { URL } from 'url'
import { DependencySession } from '../../extension/dependency'
import fetch from '../../model/fetch'

process.env.NO_PROXY = '*'

/**
 * Test dependencies for all coc.nvim extensions
 */
describe('Test dependencies ', () => {
  it('should test extensions', async () => {
    let names: string[] = []
    let obj = await fetch(`https://registry.npmjs.com/-/v1/search?text=keywords:coc.nvim&size=200&from=0`)
    for (let item of obj['objects']) {
      names.push(item['package'].name)
    }
    obj = await fetch(`https://registry.npmjs.com/-/v1/search?text=keywords:coc.nvim&size=200&from=200`)
    for (let item of obj['objects']) {
      let name = item['package'].name
      if (!names.includes(name)) {
        names.push(name)
      }
    }
    // optionalDependencies
    console.log(`total: ${names.length}`)
    let registry = new URL('https://registry.npmjs.org/')
    let session = new DependencySession(registry, os.tmpdir())

    for (let name of names) {
      console.log(`Checking module ${name}`)
      try {
        let dep = session.createInstaller(os.tmpdir(), () => {})
        await dep.checkModule(names[3])
      } catch (e) {
        console.error(`Error with ${name}`, e)
      }
    }
  }, 120 * 1000 * 60)
})
