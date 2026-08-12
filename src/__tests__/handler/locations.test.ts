import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import LocationHandler from '../../handler/locations'
import languages from '../../languages'
import services from '../../services'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, Location, LocationLink, Position, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import type LocationHandlerType from '../../handler/locations'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let nvim: Neovim
let locations: LocationHandlerType
let disposables: Disposable[] = []
let currLocations: Location[] | LocationLink[]
before(async () => {
  nvim = workspace.nvim
  Object.assign(workspace.env, {
    locationlist: false
  })
  locations = getCurrentPlugin().getHandler().locations
})

beforeEach(async () => {
  await shared.createDocument()
})

afterEach(async () => {
  disposeAll(disposables)
})

function createLocation(name: string, sl: number, sc: number, el: number, ec: number): Location {
  return Location.create(`test://${name}`, Range.create(sl, sc, el, ec))
}

function createLocationLink(name: string, sl: number, sc: number, el: number, ec: number): LocationLink {
  let r = Range.create(sl, sc, el, ec)
  return LocationLink.create(`test://${name}`, r, r)
}

describe('locations', () => {
  describe('no provider', () => {
    it('should return null when provider does not exist', async t => {
      let doc = (await workspace.document).textDocument
      let pos = Position.create(0, 0)
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      assert.deepStrictEqual(await languages.getDefinition(doc, pos, token), [])
      assert.deepStrictEqual(await languages.getDefinitionLinks(doc, pos, token), [])
      assert.deepStrictEqual(await languages.getDeclaration(doc, pos, token), [])
      assert.deepStrictEqual(await languages.getTypeDefinition(doc, pos, token), [])
      assert.deepStrictEqual(await languages.getImplementation(doc, pos, token), [])
      assert.deepStrictEqual(await languages.getReferences(doc, { includeDeclaration: false }, pos, token), [])
    })
  })

  describe('reference', () => {
    beforeEach(() => {
      disposables.push(languages.registerReferencesProvider([{ language: '*' }], {
        provideReferences: () => {
          return currLocations as any
        }
      }))
    })

    it('should get references', async t => {
      currLocations = [createLocationLink('foo', 0, 0, 0, 0), createLocationLink('bar', 0, 0, 0, 0)]
      let res = await shared.doAction('references')
      assert.strictEqual(res.length, 2)
    })

    it('should jump to references', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      let res = await shared.doAction('jumpReferences', 'edit')
      assert.strictEqual(res, true)
      let name = await nvim.call('bufname', ['%'])
      assert.strictEqual(name, 'test://foo')
    })

    it('should return false when references not found', async t => {
      currLocations = []
      let res = await locations.gotoReferences('edit', true)
      assert.strictEqual(res, false)
      res = await shared.doAction('jumpUsed', 'edit')
      assert.strictEqual(res, false)
    })
  })

  describe('definition', () => {
    beforeEach(() => {
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return currLocations
        }
      }))
    })

    it('should get definitions', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0), createLocation('bar', 0, 0, 0, 0)]
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return [createLocation('foo', 0, 0, 0, 0)]
        }
      }))
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return createLocation('foo', 0, 0, 0, 0)
        }
      }))
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return [LocationLink.create(`test://foo`, Range.create(0, 0, 0, 0), Range.create(0, 0, 0, 0)), null]
        }
      }))
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return [LocationLink.create(`test://foo`, Range.create(0, 0, 0, 0), Range.create(0, 0, 0, 0))]
        }
      }))
      let res = await shared.doAction('definitions')
      assert.strictEqual(res.length, 2)
    })

    it('should return empty locations when no definitions exist', async t => {
      currLocations = null
      let doc = await workspace.document
      let res = await languages.getDefinitionLinks(doc.textDocument, Position.create(0, 0), CancellationToken.None)
      assert.strictEqual(res.length, 0)
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      res = await languages.getDefinitionLinks(doc.textDocument, Position.create(0, 0), CancellationToken.None)
      assert.strictEqual(res.length, 0)
    })

    it('should jump to definitions', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      let res = await shared.doAction('jumpDefinition', 'edit')
      assert.strictEqual(res, true)
      let name = await nvim.call('bufname', ['%'])
      assert.strictEqual(name, 'test://foo')
    })

    it('should return false when definitions not found', async t => {
      currLocations = []
      let res = await locations.gotoDefinition('edit')
      assert.strictEqual(res, false)
    })
  })

  describe('declaration', () => {
    beforeEach(() => {
      disposables.push(languages.registerDeclarationProvider([{ language: '*' }], {
        provideDeclaration: () => {
          return currLocations
        }
      }))
    })

    it('should get declarations', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0), createLocation('bar', 0, 0, 0, 0)]
      let res = await locations.declarations() as Location[]
      assert.strictEqual(res.length, 2)
    })

    it('should jump to declaration', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      let res = await locations.gotoDeclaration('edit')
      assert.strictEqual(res, true)
      let name = await nvim.call('bufname', ['%'])
      assert.strictEqual(name, 'test://foo')
    })

    it('should return false when declaration not found', async t => {
      currLocations = []
      let res = await shared.doAction('jumpDeclaration', 'edit')
      assert.strictEqual(res, false)
    })
  })

  describe('typeDefinition', () => {
    beforeEach(() => {
      disposables.push(languages.registerTypeDefinitionProvider([{ language: '*' }], {
        provideTypeDefinition: () => {
          return currLocations
        }
      }))
    })

    it('should get type definition', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0), createLocation('bar', 0, 0, 0, 0)]
      let res = await shared.doAction('typeDefinitions')
      assert.strictEqual(res.length, 2)
    })

    it('should jump to type definition', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      let res = await locations.gotoTypeDefinition('edit')
      assert.strictEqual(res, true)
      let name = await nvim.call('bufname', ['%'])
      assert.strictEqual(name, 'test://foo')
    })

    it('should return false when type definition not found', async t => {
      currLocations = []
      let res = await shared.doAction('jumpTypeDefinition', 'edit')
      assert.strictEqual(res, false)
    })
  })

  describe('implementation', () => {
    beforeEach(() => {
      disposables.push(languages.registerImplementationProvider([{ language: '*' }], {
        provideImplementation: () => {
          return currLocations
        }
      }))
    })

    it('should get implementations', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0), createLocation('bar', 0, 0, 0, 0)]
      let res = await shared.doAction('implementations')
      assert.strictEqual(res.length, 2)
    })

    it('should jump to implementation', async t => {
      currLocations = [createLocation('foo', 0, 0, 0, 0)]
      let res = await shared.doAction('jumpImplementation', 'edit')
      assert.strictEqual(res, true)
      let name = await nvim.call('bufname', ['%'])
      assert.strictEqual(name, 'test://foo')
    })

    it('should return false when implementation not found', async t => {
      currLocations = []
      let res = await locations.gotoImplementation('edit')
      assert.strictEqual(res, false)
    })
  })

  describe('getTagList', () => {
    it('should return null when cword does not exist', async t => {
      let res = await shared.doAction('getTagList')
      assert.strictEqual(res, null)
    })

    it('should return null when provider does not exist', async t => {
      await nvim.setLine('foo')
      await nvim.command('normal! ^')
      let res = await locations.getTagList()
      assert.strictEqual(res, null)
    })

    it('should null when buffer not attached', async t => {
      let doc = await workspace.document
      if (doc) doc.detach()
      let res = await locations.getTagList()
      assert.strictEqual(res, null)
    })

    it('should return null when result is empty', async t => {
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return []
        }
      }))
      await nvim.setLine('foo')
      await nvim.command('normal! ^')
      let res = await locations.getTagList()
      assert.strictEqual(res, null)
    })

    it('should return tag definitions', async t => {
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition: () => {
          return [createLocation('bar', 2, 0, 2, 5), Location.create(URI.file('/foo').toString(), Range.create(1, 0, 1, 5))]
        }
      }))
      await nvim.setLine('foo')
      await nvim.command('normal! ^')
      let res = await locations.getTagList()
      assert.deepStrictEqual(res, [
        {
          name: 'foo',
          cmd: 'silent keepjumps call coc#cursor#move_to(2, 0)',
          filename: 'test://bar'
        },
        { name: 'foo', cmd: 'silent keepjumps call coc#cursor#move_to(1, 0)', filename: '/foo' }
      ])
    })
  })

  describe('findLocations', () => {
    // hook result
    let fn
    let result: any
    before(() => {
      fn = services.sendRequest
      services.sendRequest = () => {
        return Promise.resolve(result)
      }
    })

    after(() => {
      services.sendRequest = fn
    })

    it('should handle locations from language client', async t => {
      result = [createLocation('bar', 2, 0, 2, 5)]
      await shared.doAction('findLocations', 'foo', 'mylocation', {}, false)
      let res = await nvim.getVar('coc_jump_locations')
      assert.deepStrictEqual(res, [{
        uri: 'test://bar',
        lnum: 3,
        end_lnum: 3,
        col: 1,
        end_col: 6,
        filename: 'test://bar',
        text: '',
        range: Range.create(2, 0, 2, 5)
      }])
    })

    it('should handle empty result', async t => {
      result = null
      let res = await locations.findLocations('foo', 'mylocation', undefined, 'edit')
      assert.strictEqual(res, false)
    })

    it('should handle nested locations', async t => {
      let location: any = {
        location: createLocation('file', 0, 0, 0, 0),
        children: [{
          location: createLocation('foo', 3, 0, 3, 5),
          children: []
        }, {
          location: createLocation('bar', 4, 0, 4, 5),
          children: []
        }]
      }
      result = location
      await locations.findLocations('foo', 'mylocation', {})
      let res = await nvim.getVar('coc_jump_locations') as any[]
      assert.strictEqual(res.length, 3)
    })
  })

  describe('toLocations()', () => {
    it('should convert to locations', async t => {
      let loc = createLocation('file', 0, 0, 0, 0)
      assert.strictEqual(locations.toLocations(loc).length, 1)
      assert.strictEqual(locations.toLocations([loc]).length, 1)
      let link = LocationLink.create(`test://a`, Range.create(0, 0, 1, 0), Range.create(0, 0, 0, 1))
      assert.strictEqual(locations.toLocations(link).length, 1)
      assert.strictEqual(locations.toLocations([link]).length, 1)
      assert.strictEqual(locations.toLocations(null).length, 0)
      assert.strictEqual(locations.toLocations(undefined).length, 0)
      let location: any = {
        location: createLocation('file', 0, 0, 0, 0),
        children: [{
          location: link,
          children: [{
            location: loc
          }, null, undefined, {}]
        }]
      }
      assert.strictEqual(locations.toLocations(location).length, 3)
    })
  })

  describe('handleLocations', () => {
    it('should not throw when locations is undefined', async t => {
      await locations.handleLocations(undefined)
    })

    it('should not throw when locations is empty array', async t => {
      await locations.handleLocations([])
    })
  })
})
