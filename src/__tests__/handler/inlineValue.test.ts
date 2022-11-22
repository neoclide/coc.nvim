import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, InlineValueText, Range } from 'vscode-languageserver-protocol'
import languages, { ProviderName } from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  // hover = helper.plugin.getHandler().hover
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(async () => {
  await helper.createDocument()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('InlineValue', () => {
  describe('InlineValueManager', () => {
    it('should return false when provider not exists', async () => {
      let doc = await workspace.document
      let res = languages.hasProvider(ProviderName.InlineValue, doc.textDocument)
      expect(res).toBe(false)
    })

    it('should return merged results', async () => {
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return null
        }
      }))
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return [
            InlineValueText.create(Range.create(0, 0, 0, 1), 'foo'),
            InlineValueText.create(Range.create(0, 3, 0, 5), 'bar'),
          ]
        }
      }))
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return [
            InlineValueText.create(Range.create(0, 0, 0, 1), 'foo'),
          ]
        }
      }))
      let doc = await workspace.document
      let res = await languages.provideInlineValues(doc.textDocument, Range.create(0, 0, 3, 0), { frameId: 3, stoppedLocation: Range.create(0, 0, 0, 3) }, CancellationToken.None)
      expect(res.length).toBe(2)
    })
  })
})
