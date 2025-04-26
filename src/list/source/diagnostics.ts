'use strict'
import { URI } from 'vscode-uri'
import diagnosticManager, { DiagnosticItem } from '../../diagnostic/manager'
import { severityLevel } from '../../diagnostic/util'
import { defaultValue } from '../../util'
import { isParentFolder } from '../../util/fs'
import { path } from '../../util/node'
import workspace from '../../workspace'
import { formatListItems, formatPath, PathFormatting, UnformattedListItem } from '../formatting'
import { ListManager } from '../manager'
import { ListArgument, ListContext, ListItem } from '../types'
import LocationList from './location'

export function convertToLabel(item: DiagnosticItem, cwd: string, includeCode: boolean, pathFormat: PathFormatting = 'full'): string[] {
  const file = isParentFolder(cwd, item.file) ? path.relative(cwd, item.file) : item.file
  const formattedPath = formatPath(pathFormat, file)
  const formattedPosition = pathFormat !== "hidden" ? [`${formattedPath}:${item.lnum}`] : []
  const source = includeCode ? `[${item.source} ${defaultValue(item.code, '')}]` : item.source
  return [...formattedPosition, source, item.severity, item.message]
}

export default class DiagnosticsList extends LocationList {
  public readonly defaultAction = 'open'
  public readonly description = 'diagnostics of current workspace'
  public name = 'diagnostics'
  public options: ListArgument[] = [{
    name: '--buffer',
    hasValue: false,
    description: 'list diagnostics of current buffer only',
  }, {
    name: '--workspace-folder',
    hasValue: false,
    description: 'list diagnostics of current workspace folder only',
  }, {
    name: '-l, -level LEVEL',
    hasValue: true,
    description: 'filter diagnostics by diagnostic level, could be "error", "warning" and "information"'
  }]
  public constructor(manager: ListManager, event = true) {
    super()
    if (event) {
      diagnosticManager.onDidRefresh(async () => {
        let session = manager.getSession('diagnostics')
        if (session) await session.reloadItems()
      }, null, this.disposables)
    }
  }

  public async filterDiagnostics(parsedArgs: { [key: string]: string | boolean }): Promise<DiagnosticItem[]> {
    let list = await diagnosticManager.getDiagnosticList()
    if (parsedArgs['workspace-folder']) {
      const folder = workspace.getWorkspaceFolder(workspace.root)
      if (folder) {
        const normalized = URI.parse(folder.uri)
        list = list.filter(item => isParentFolder(normalized.fsPath, item.file))
      }
    } else if (parsedArgs.buffer) {
      const doc = await workspace.document
      const normalized = URI.parse(doc.uri)
      list = list.filter(item => item.file === normalized.fsPath)
    }
    if (typeof parsedArgs.level === 'string') {
      let level = severityLevel(parsedArgs.level)
      list = list.filter(item => item.level <= level)
    }
    return list
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let { cwd, args } = context
    const parsedArgs = this.parseArguments(args)
    let list = await this.filterDiagnostics(parsedArgs)
    const config = this.getConfig()
    const includeCode = config.get<boolean>('includeCode', true)
    const pathFormat = config.get<PathFormatting>('pathFormat', "full")
    const unformatted: UnformattedListItem[] = list.map(item => {
      return {
        label: convertToLabel(item, cwd, includeCode, pathFormat),
        location: item.location,
      }
    })
    return formatListItems(this.alignColumns, unformatted)
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocDiagnosticsFile /\\v^\\s*\\S+/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsError /\\tError\\s*\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsWarning /\\tWarning\\s*\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsInfo /\\tInformation\\s*\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsHint /\\tHint\\s*\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('highlight default link CocDiagnosticsFile Comment', true)
    nvim.command('highlight default link CocDiagnosticsError CocErrorSign', true)
    nvim.command('highlight default link CocDiagnosticsWarning CocWarningSign', true)
    nvim.command('highlight default link CocDiagnosticsInfo CocInfoSign', true)
    nvim.command('highlight default link CocDiagnosticsHint CocHintSign', true)
    nvim.resumeNotification(false, true)
  }
}
