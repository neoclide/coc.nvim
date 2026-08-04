'use strict'
import { createLogger } from '../logger'
import diagnosticManager from '../diagnostic/manager'
import services from '../services'
import { fs } from '../util/node'
import { Disposable } from '../util/protocol'
import workspace from '../workspace'
import { resolveDocument, toFsPath } from './tools/util'
const logger = createLogger('mcp-resources')

export interface ResourceInfo {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface ResourceTemplateInfo {
  uriTemplate: string
  name?: string
  description?: string
}

export interface ResourceContent {
  uri: string
  mimeType?: string
  text: string
}

export class ResourceNotFoundError extends Error {
  public readonly code = -32002
}

const DOCUMENT_PREFIX = 'coc://documents/'

export class ResourceManager implements Disposable {
  public documentUri(fileUri: string): string {
    return DOCUMENT_PREFIX + encodeURIComponent(fileUri)
  }

  public listResources(): { resources: ResourceInfo[] } {
    let resources: ResourceInfo[] = []
    try {
      for (let doc of workspace.documents) {
        resources.push({
          uri: this.documentUri(doc.uri),
          name: doc.uri,
          mimeType: 'text/plain'
        })
      }
    } catch (_e) {
      // documents manager not initialized
    }
    resources.push({ uri: 'coc://diagnostics', name: 'Workspace diagnostics', mimeType: 'application/json' })
    resources.push({ uri: 'coc://services', name: 'Language server status', mimeType: 'application/json' })
    resources.push({ uri: 'coc://workspace', name: 'Workspace information', mimeType: 'application/json' })
    return { resources }
  }

  public listTemplates(): { resourceTemplates: ResourceTemplateInfo[] } {
    return {
      resourceTemplates: [{
        uriTemplate: DOCUMENT_PREFIX + '{uri}',
        name: 'Document content',
        description: 'Text content of an editor document (file URI encoded as parameter).'
      }]
    }
  }

  public async read(uri: string): Promise<{ contents: ResourceContent[] }> {
    if (uri.startsWith(DOCUMENT_PREFIX)) {
      let fileUri = decodeURIComponent(uri.slice(DOCUMENT_PREFIX.length))
      let ref = await resolveDocument(fileUri, false)
      if (ref.error) throw new ResourceNotFoundError(ref.error)
      let text: string
      if (ref.doc) {
        text = ref.doc.getDocumentContent()
      } else {
        try {
          text = fs.readFileSync(toFsPath(fileUri), 'utf8')
        } catch (e) {
          throw new ResourceNotFoundError(e instanceof Error ? e.message : String(e))
        }
      }
      return { contents: [{ uri, mimeType: 'text/plain', text }] }
    }
    switch (uri) {
      case 'coc://diagnostics': {
        let list = await diagnosticManager.getDiagnosticList()
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(list, null, 2) }] }
      }
      case 'coc://services': {
        let stats = services.getServiceStats().map(stat => {
          let service = services.getService(stat.id)
          let init = service?.client?.initializeResult
          return {
            id: stat.id,
            state: stat.state,
            languageIds: stat.languageIds,
            capabilities: init?.capabilities ?? null
          }
        })
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }] }
      }
      case 'coc://workspace': {
        let info = {
          version: workspace.version,
          cwd: workspace.cwd || process.cwd(),
          root: workspace.root || process.cwd(),
          folders: workspace.folderPaths
        }
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(info, null, 2) }] }
      }
      default:
        throw new ResourceNotFoundError(`Resource not found: ${uri}`)
    }
  }

  public dispose(): void {
    // nothing to dispose
  }
}
