'use strict'
import diagnosticManager, { DiagnosticItem } from '../../diagnostic/manager'
import { defaultValue } from '../../util'
import { isParentFolder } from '../../util/fs'
import { path } from '../../util/node'
import { formatListItems, formatPath, PathFormatting, UnformattedListItem } from '../formatting'
import { ListManager } from '../manager'
import { ListContext, ListItem } from '../types'
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
  public constructor(manager: ListManager) {
    super()
    diagnosticManager.onDidRefresh(async () => {
      let session = manager.getSession('diagnostics')
      if (session) await session.reloadItems()
    }, null, this.disposables)
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let list = await diagnosticManager.getDiagnosticList()
    let { cwd } = context
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
