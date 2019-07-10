import path from 'path'
import diagnosticManager from '../../diagnostic/manager'
import { DiagnosticItem, ListContext, ListItem } from '../../types'
import LocationList from './location'
import { isParentFolder } from '../../util/fs'
const logger = require('../../util/logger')('list-symbols')

export default class DiagnosticsList extends LocationList {
  public readonly defaultAction = 'open'
  public readonly description = 'diagnostics of current workspace'
  public name = 'diagnostics'

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let list: DiagnosticItem[] = diagnosticManager.getDiagnosticList()
    let { cwd } = context
    return list.map(item => {
      let file = isParentFolder(cwd, item.file) ? path.relative(cwd, item.file) : item.file
      return {
        label: `${file}:${item.lnum}:${item.col}\t${item.severity}\t${item.message.replace(/\n/g, '')}`,
        location: item.location
      }
    })
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocDiagnosticsFile /\\v^\\s*\\S+/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsError /\\tError\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsWarning /\\tWarning\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsInfo /\\tInformation\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('syntax match CocDiagnosticsHint /\\tHint\\t/ contained containedin=CocDiagnosticsLine', true)
    nvim.command('highlight default link CocDiagnosticsFile Comment', true)
    nvim.command('highlight default link CocDiagnosticsError CocErrorSign', true)
    nvim.command('highlight default link CocDiagnosticsWarning CocWarningSign', true)
    nvim.command('highlight default link CocDiagnosticsInfo CocInfoSign', true)
    nvim.command('highlight default link CocDiagnosticsHint CocHintSign', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}
