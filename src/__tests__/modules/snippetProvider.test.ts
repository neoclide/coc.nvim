import path from 'path'
import helper from '../helper'
import extensions from '../../extensions'
import { loadSnippetsFromFile, loadSnippetsFromText, ExtensionSnippetProvider, CompositeSnippetProvider } from '../../snippets/provider'

let extensionProvider: ExtensionSnippetProvider
let compositeProvider: CompositeSnippetProvider
beforeAll(async () => {
  await helper.setup()
  let extensionPath = path.resolve(__dirname, '../extensions/snippet-sample')
  await extensions.loadExtension(extensionPath)
  extensionProvider = new ExtensionSnippetProvider()
  compositeProvider = new CompositeSnippetProvider()
  compositeProvider.registerProvider(extensionProvider)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('snippet provider', () => {

  it('should load snippets from text #1', () => {
    let res = loadSnippetsFromText('')
    expect(res.length).toBe(0)
  })

  it('should load snippets from text #2', () => {
    let obj = {
      foo: {
        prefix: "prefix",
        body: "${1:for}",
        description: "foo"
      }
    }
    let res = loadSnippetsFromText('// foo\n' + JSON.stringify(obj))
    expect(res.length).toBe(1)
    expect(res[0].description).toBe('foo')
  })

  it('should not load snippet from file not exists', async () => {
    try {
      await loadSnippetsFromFile('foo')
      fail()
    } catch (e) {
      expect(e.code).toBe('ENOENT')
    }
  })

  it('should load snippets from extension', async () => {
    await helper.wait(30)
    let snippets = extensionProvider.getSnippets('javascript')
    expect(snippets.length).toBe(1)
    snippets = extensionProvider.getSnippets('javascriptreact')
    expect(snippets.length).toBe(1)
  })

  it('should load snippets from composite provider', async () => {
    await helper.wait(30)
    let snippets = await compositeProvider.getSnippets('javascript')
    expect(snippets.length).toBe(1)
    snippets = await compositeProvider.getSnippets('javascriptreact')
    expect(snippets.length).toBe(1)
  })
})
