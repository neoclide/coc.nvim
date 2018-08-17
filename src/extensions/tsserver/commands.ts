import { CancellationToken } from 'vscode-languageserver-protocol'
import URI from 'vscode-uri'
import { Command } from '../../commands'
import workspace from '../../workspace'
import { ProjectInfoResponse } from './protocol'
import TypeScriptServiceClientHost from './typescriptServiceClientHost'

export class ReloadProjectsCommand implements Command {
  public readonly id = 'tsserver.reloadProjects'

  public constructor(
    private readonly client: TypeScriptServiceClientHost
  ) { }

  public execute(): void {
    this.client.reloadProjects()
    workspace.showMessage('projects reloaded')
  }
}

export class OpenTsServerLogCommand implements Command {
  public readonly id = 'tsserver.openTsServerLog'

  public constructor(
    private readonly client: TypeScriptServiceClientHost
  ) { }

  public execute(): void {
    this.client.serviceClient.openTsServerLogFile() // tslint:disable-line
  }
}

export class TypeScriptGoToProjectConfigCommand implements Command {
  public readonly id = 'tsserver.goToProjectConfig'

  public constructor(
    private readonly client: TypeScriptServiceClientHost
  ) { }

  public async execute(): Promise<void> {
    let doc = await workspace.document
    await goToProjectConfig(this.client, doc.uri)
  }
}

async function goToProjectConfig(clientHost: TypeScriptServiceClientHost, uri: string): Promise<void> {
  if (!clientHost.handles(uri)) {
    workspace.showMessage('Could not determine TypeScript or JavaScript project. Unsupported file type', 'warning')
    return
  }
  const client = clientHost.serviceClient
  const file = client.toPath(uri)
  let res: ProjectInfoResponse | undefined
  try {
    res = await client.execute('projectInfo', { file, needFileNameList: false }, CancellationToken.None)
  } catch {
    // noop
  }
  if (!res || !res.body) {
    workspace.showMessage('Could not determine TypeScript or JavaScript project.', 'warning')
    return
  }

  const { configFileName } = res.body
  if (configFileName && !isImplicitProjectConfigFile(configFileName)) {
    await workspace.openResource(URI.file(configFileName).toString())
    return
  }

  workspace.showMessage('Config file not found', 'warning')
}

function isImplicitProjectConfigFile(configFileName: string): boolean {
  return configFileName.indexOf('/dev/null/') === 0
}
