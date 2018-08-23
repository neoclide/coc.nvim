import { echoMessage } from '../../util'
import workspace from '../../workspace'
import { Configuration } from './configuration'

export function verifyGemIsCurrent(): void {
  workspace.runCommand('gem outdated').then(res => {
    if (res.match(/[\s]solargraph[\s]/)) {
      notifyGemUpdate()
    } else {
      echoMessage(workspace.nvim, 'The Solargraph gem is up to date.')
    }
  }, _e => {
    // noop
  })
}

export function downloadCore(configuration: Configuration): void {
  let cmd = getCommands(configuration, 'download-core')
  workspace.nvim.call('coc#util#open_terminal', [{
    id: 0,
    cmd
  }], true)
}

export function createConfig(configuration: Configuration): void {
  let cmd = getCommands(configuration, 'download-core')
  workspace.runCommand(cmd).then(res => {
    if (res) {
      echoMessage(workspace.nvim, 'Created default .solargraph.yml file.')
    }
  }, _e => {
    // noop
  })
}

function getCommands(configuration: Configuration, ...args: string[]): string {
  let cmds = []
  if (configuration.useBundler) {
    cmds.push(configuration.bundlerPath, 'exec', 'solargraph')
  } else {
    cmds.push(configuration.commandPath)
  }
  cmds.push(...args)
  return cmds.join(' ')
}

function notifyGemUpdate(): void {
  if (workspace.getConfiguration('solargraph').useBundler) {
    echoMessage(workspace.nvim, 'A new version of the Solargraph gem is available. Update your Gemfile to install it.')
  } else {
    echoMessage(workspace.nvim, 'A new version of the Solargraph gem is available. Run `gem update solargraph` to install it.')
  }
}
