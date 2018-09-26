import { Snippet, SnippetProvider } from '../types'
import fs from 'fs'
import os from 'os'
import path from 'path'
import extensions from '../extensions'
import workspace from '../workspace'
import { parse, ParseError } from 'jsonc-parser'

const logger = require('../util/logger')('snippets-provider')

export interface SnippetDefinition  {
  language: string
  path: string
}

export class CompositeSnippetProvider implements SnippetProvider {
  private _providers: SnippetProvider[] = []

  public registerProvider(provider: SnippetProvider): void {
    this._providers.push(provider)
  }

  public async getSnippets(language: string): Promise<Snippet[]> {
    let configuration = workspace.getConfiguration('coc.preferences')
    if (!configuration.get<boolean>('snippets.enable')) {
      return []
    }

    const snippets = this._providers.map(p => p.getSnippets(language))

    const allSnippets = await Promise.all(snippets)

    return allSnippets.reduce((prev, cur) => {
      return [...prev, ...cur]
    }, [])
  }

  public refresh(): void {
    for (let p of this._providers) {
      if (typeof p.refresh == 'function') {
        p.refresh()
      }
    }
  }
}

export interface ISnippetPluginContribution {
  prefix: string
  body: string[]
  description: string
}

export class ExtensionSnippetProvider implements SnippetProvider {
  private _snippetCache: { [language: string]: Snippet[] } = {}

  constructor() {
    extensions.onDidLoadExtension(extension => {
      let { contributes } = extension.packageJSON
      if (contributes.snippets) {
        let keys = Object.keys(this._snippetCache)
        for (let item of contributes.snippets) {
          if (keys.indexOf(item.language) !== -1) {
            delete this._snippetCache[item.language]
          }
        }
      }
    })
  }

  public async getSnippets(language: string): Promise<Snippet[]> {
    // If we have existing snippets, we'll use those...
    const currentSnippets = this._snippetCache[language]
    if (currentSnippets) {
      return currentSnippets
    }

    // Otherwise, we need to discover snippets
    let defs: SnippetDefinition[] = []

    extensions.all.forEach(p => {
      let { packageJSON } = p
      if (packageJSON.contributes && packageJSON.contributes.snippets) {
        let { snippets } = packageJSON.contributes
        for (let item of snippets) {
          if (item.language == language) {
            defs.push({
              language,
              path: path.join(p.extensionPath, item.path)
            })
          }
        }
      }
    })

    const loadedSnippets = await Promise.all(defs.map(s => this._loadSnippetsFromFile(s.path)))

    const flattenedSnippets = loadedSnippets.reduce(
      (x: Snippet[], y: Snippet[]) => [...x, ...y],
      [],
    )

    this._snippetCache[language] = flattenedSnippets
    return flattenedSnippets
  }

  public refresh(): void {
    this._snippetCache = {}
  }

  private async _loadSnippetsFromFile(snippetFilePath: string): Promise<Snippet[]> {
    return loadSnippetsFromFile(snippetFilePath)
  }
}

export const loadSnippetsFromFile = async (
  snippetFilePath: string,
): Promise<Snippet[]> => {
  logger.debug('[loadSnippetsFromFile] Trying to load snippets from: ' + snippetFilePath)
  const contents = await new Promise<string>((resolve, reject) => {
    fs.readFile(snippetFilePath, "utf8", (err, data) => {
      if (err) {
        reject(err)
        return
      }

      resolve(data)
    })
  })

  const snippets = loadSnippetsFromText(contents)

  logger.debug(`[loadSnippetsFromFile] - Loaded ${snippets.length} snippets from ${snippetFilePath}`)

  return snippets
}

interface KeyToSnippet {
  [key: string]: ISnippetPluginContribution
}

export const loadSnippetsFromText = (contents: string): Snippet[] => {
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
        body: typeof snip.body === "string" ? snip.body : snip.body.join(os.EOL),
      }
    },
  )

  return normalizedSnippets
}
