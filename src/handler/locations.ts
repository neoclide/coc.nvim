'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Location, LocationLink, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import languages from '../languages'
import services from '../services'
import { HandlerDelegate, LocationWithTarget, ProviderName } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('handler-hover')

export interface TagDefinition {
  name: string
  cmd: string
  filename: string
}

export type RequestFunc<T> = (doc: TextDocument, position: Position, token: CancellationToken) => Thenable<T>

export default class LocationsHandler {
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
  }

  private async request<T>(method: ProviderName, fn: RequestFunc<T>): Promise<T | null> {
    let { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier(method, doc.textDocument)
    await doc.synchronize()
    return await this.handler.withRequestToken(method, token => {
      return fn(doc.textDocument, position, token)
    }, true)
  }

  public async definitions(): Promise<Location[]> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('definition', doc.textDocument)
    await doc.synchronize()
    const tokenSource = new CancellationTokenSource()
    return languages.getDefinition(doc.textDocument, position, tokenSource.token)
  }

  public async declarations(): Promise<Location | Location[] | LocationLink[]> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('declaration', doc.textDocument)
    await doc.synchronize()
    const tokenSource = new CancellationTokenSource()
    return languages.getDeclaration(doc.textDocument, position, tokenSource.token)
  }

  public async typeDefinitions(): Promise<Location[]> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('typeDefinition', doc.textDocument)
    await doc.synchronize()
    const tokenSource = new CancellationTokenSource()
    return languages.getTypeDefinition(doc.textDocument, position, tokenSource.token)
  }

  public async implementations(): Promise<Location[]> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('implementation', doc.textDocument)
    await doc.synchronize()
    const tokenSource = new CancellationTokenSource()
    return languages.getImplementation(doc.textDocument, position, tokenSource.token)
  }

  public async references(excludeDeclaration?: boolean): Promise<Location[]> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('reference', doc.textDocument)
    await doc.synchronize()
    const tokenSource = new CancellationTokenSource()
    return languages.getReferences(doc.textDocument, { includeDeclaration: !excludeDeclaration }, position, tokenSource.token)
  }

  public async gotoDefinition(openCommand?: string | false): Promise<boolean> {
    let definition = await this.request('definition', (doc, position, token) => {
      return languages.getDefinition(doc, position, token)
    })
    await this.handleLocations(definition, openCommand)
    return definition ? definition.length > 0 : false
  }

  public async gotoDeclaration(openCommand?: string | false): Promise<boolean> {
    let definition = await this.request('declaration', (doc, position, token) => {
      return languages.getDeclaration(doc, position, token)
    })
    await this.handleLocations(definition, openCommand)
    return definition ? definition.length > 0 : false
  }

  public async gotoTypeDefinition(openCommand?: string | false): Promise<boolean> {
    let definition = await this.request('typeDefinition', (doc, position, token) => {
      return languages.getTypeDefinition(doc, position, token)
    })
    await this.handleLocations(definition, openCommand)
    return definition ? definition.length > 0 : false
  }

  public async gotoImplementation(openCommand?: string | false): Promise<boolean> {
    let definition = await this.request('implementation', (doc, position, token) => {
      return languages.getImplementation(doc, position, token)
    })
    await this.handleLocations(definition, openCommand)
    return definition ? definition.length > 0 : false
  }

  public async gotoReferences(openCommand?: string | false, includeDeclaration = true): Promise<boolean> {
    let definition = await this.request('reference', (doc, position, token) => {
      return languages.getReferences(doc, { includeDeclaration }, position, token)
    })
    await this.handleLocations(definition, openCommand)
    return definition ? definition.length > 0 : false
  }

  public async getTagList(): Promise<TagDefinition[] | null> {
    let { doc, position } = await this.handler.getCurrentState()
    let word = await this.nvim.call('expand', '<cword>')
    if (!word) return null
    if (!languages.hasProvider('definition', doc.textDocument)) return null
    let tokenSource = new CancellationTokenSource()
    let definitions = await languages.getDefinition(doc.textDocument, position, tokenSource.token)
    if (!definitions || !definitions.length) return null
    return definitions.map(location => {
      let parsedURI = URI.parse(location.uri)
      const filename = parsedURI.scheme == 'file' ? parsedURI.fsPath : parsedURI.toString()
      return {
        name: word,
        cmd: `keepjumps ${location.range.start.line + 1} | normal ${location.range.start.character + 1}|`,
        filename,
      }
    })
  }

  /**
   * Send custom request for locations to services.
   */
  public async findLocations(id: string, method: string, params: any, openCommand: string | false = false): Promise<boolean> {
    let { doc, position } = await this.handler.getCurrentState()
    params = params || {}
    Object.assign(params, {
      textDocument: { uri: doc.uri },
      position
    })
    let res: any = await services.sendRequest(id, method, params)
    let locations = this.toLocations(res)
    await this.handleLocations(locations, openCommand)
    return locations.length > 0
  }

  public toLocations(location: Location | LocationLink | Location[] | LocationLink[] | null): LocationWithTarget[] {
    let res: LocationWithTarget[] = []
    if (location && location.hasOwnProperty('location') && location.hasOwnProperty('children')) {
      let getLocation = (item: any): void => {
        if (!item) return
        if (Location.is(item.location)) {
          res.push(item.location)
        } else if (LocationLink.is(item.location)) {
          let loc = item.location as LocationLink
          res.push({
            uri: loc.targetUri,
            range: loc.targetSelectionRange,
            targetRange: loc.targetRange
          })
        }
        if (item.children && item.children.length) {
          for (let loc of item.children) {
            getLocation(loc)
          }
        }
      }
      getLocation(location)
      return res
    }
    if (Location.is(location)) {
      res.push(location)
    } else if (LocationLink.is(location)) {
      res.push({
        uri: location.targetUri,
        range: location.targetSelectionRange,
        targetRange: location.targetRange
      })
    } else if (Array.isArray(location)) {
      for (let loc of location) {
        if (Location.is(loc)) {
          res.push(loc)
        } else if (loc && typeof loc.targetUri === 'string') {
          res.push({
            uri: loc.targetUri,
            range: loc.targetSelectionRange,
            targetRange: loc.targetRange
          })
        }
      }
    }
    return res
  }

  public async handleLocations(locations: LocationWithTarget[] | null | undefined, openCommand?: string | false): Promise<void> {
    if (!locations) return
    let len = locations.length
    if (len == 0) return
    if (len == 1 && openCommand !== false) {
      let { uri, range } = locations[0]
      await workspace.jumpTo(uri, range.start, openCommand)
    } else {
      await workspace.showLocations(locations)
    }
  }
}
