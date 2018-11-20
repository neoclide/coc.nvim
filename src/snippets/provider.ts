import fs from 'fs'
import { parse, ParseError } from 'jsonc-parser'
import os from 'os'
import path from 'path'
import extensions from '../extensions'
import { Extension, Snippet, SnippetProvider } from '../types'
import workspace from '../workspace'
import { Disposable } from 'vscode-jsonrpc'

const logger = require('../util/logger')('snippets-provider')

export interface ISnippetPluginContribution {
  prefix: string
  body: string[]
  description: string
}

export interface SnippetDefinition {
  extensionId: string
  // path => languageIds
  snippets: Map<string, string[]>
}

export interface SnippetCache {
  [language: string]: Snippet[]
}

export interface ExtensionCache {
  [id: string]: SnippetCache
}

interface KeyToSnippet {
  [key: string]: ISnippetPluginContribution
}

export class CompositeSnippetProvider implements SnippetProvider {
  private _providers: SnippetProvider[] = []

  public registerProvider(provider: SnippetProvider): Disposable {
    if (this._providers.indexOf(provider) == -1) {
      this._providers.push(provider)
    }
    return Disposable.create(() => {
      let idx = this._providers.indexOf(provider)
      if (idx !== -1) this._providers.splice(idx, 1)
    })
  }

  public async getSnippets(language: string): Promise<Snippet[]> {
    let configuration = workspace.getConfiguration('coc.preferences')
    if (!configuration.get<boolean>('snippets.enable')) return []

    const snippets = this._providers.map(p => p.getSnippets(language))

    const allSnippets = await Promise.all(snippets)

    return allSnippets.reduce((prev, cur) => {
      return [...prev, ...cur]
    }, [])
  }
}

export class ExtensionSnippetProvider implements SnippetProvider {
  private _snippetCache: ExtensionCache = {}

  constructor() {
    extensions.all.forEach(extension => {
      this.loadSnippetsFromExtension(extension)
    })
    extensions.onDidLoadExtension(extension => {
      this.loadSnippetsFromExtension(extension)
    })
    extensions.onDidUnloadExtension(id => {
      delete this._snippetCache[id]
    })
  }

  private loadSnippetsFromExtension(extension: Extension<any>): void {
    let { packageJSON } = extension
    if (packageJSON.contributes && packageJSON.contributes.snippets) {
      let { snippets } = packageJSON.contributes
      let map: Map<string, string[]> = new Map()
      let def: SnippetDefinition = {
        extensionId: extension.id,
        snippets: map
      }
      for (let item of snippets) {
        let p = path.join(extension.extensionPath, item.path)
        let { language } = item
        let ids: string[] = map.get(p) || []
        ids.push(language)
        map.set(p, ids)
      }
      if (snippets && snippets.length) {
        this.loadSnippetsFromDefinition(def).catch(_e => {
          // noop
        })
      }
    }
  }

  private async loadSnippetsFromDefinition(def: SnippetDefinition): Promise<void> {
    let { extensionId, snippets } = def
    let cache = this._snippetCache[extensionId] = {}
    for (let path of snippets.keys()) {
      let arr = await loadSnippetsFromFile(path)
      let languageIds = snippets.get(path)
      for (let id of languageIds) {
        cache[id] = arr
      }
    }
  }

  public getSnippets(language: string): Snippet[] {
    let res: Snippet[] = []
    for (let key of Object.keys(this._snippetCache)) {
      let cache = this._snippetCache[key]
      let snippets = cache[language]
      if (snippets) res.push(...snippets)
    }
    return res
  }
}

export async function loadSnippetsFromFile(snippetFilePath: string): Promise<Snippet[]> {
  const contents = await new Promise<string>((resolve, reject) => {
    fs.readFile(snippetFilePath, "utf8", (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })
  const snippets = loadSnippetsFromText(contents)
  logger.debug(`[loadSnippetsFromFile] - Loaded ${snippets.length} snippets from ${snippetFilePath}`)
  return snippets
}

export function loadSnippetsFromText(contents: string): Snippet[] {
  let snippets: ISnippetPluginContribution[] = []
  try {
    let errors: ParseError[] = []
    let snippetObject = parse(contents, errors, { allowTrailingComma: true }) as KeyToSnippet
    if (errors.length) {
      logger.error(`parse error: ${errors[0].error}`)
    }
    for (let key of Object.keys(snippetObject)) {
      snippets.push(snippetObject[key])
    }
  } catch (ex) {
    logger.error(ex)
    snippets = []
  }
  const normalizedSnippets = snippets.map(
    (snip: ISnippetPluginContribution): Snippet => {
      return {
        prefix: snip.prefix,
        description: snip.description,
        body: typeof snip.body === 'string' ? snip.body : snip.body.join(os.EOL),
      }
    },
  )
  return normalizedSnippets
}
