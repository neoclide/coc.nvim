import * as solargraph from '@chemzqm/solargraph-utils'
import {Disposable, Emitter, Event} from 'vscode-languageserver-protocol'
import which from 'which'
import commandManager from '../../commands'
import {LanguageClient, State} from '../../language-client/main'
import {IServiceProvider, LanguageServerConfig, ServiceStat} from '../../types'
import {disposeAll, echoErr, echoMessage} from '../../util'
import workspace from '../../workspace'
import {makeLanguageClient} from './language-client'
const logger = require('../../util/logger')('extension-solargraph')

export default class SolargraphService implements IServiceProvider {
  public readonly id: string
  public readonly name: string
  public enable: boolean
  public languageIds: string[]
  public readonly state: ServiceStat
  private client: LanguageClient
  private config: LanguageServerConfig
  private socketProvider: solargraph.SocketProvider
  private _onDidServiceReady = new Emitter<void>()
  private configurations: solargraph.Configuration
  private readonly disposables: Disposable[] = []
  public readonly onServiceReady: Event<void> = this._onDidServiceReady.event

  constructor() {
    this.id = 'solargraph'
    this.name = 'Ruby language server'
    this.state = ServiceStat.Initial
    let config = this.config = workspace
      .getConfiguration()
      .get<LanguageServerConfig>('solargraph')
    let commandPath = config.commandPath || 'solargraph'
    try {
      which.sync(commandPath)
      this.enable = this.config.enable !== false
    } catch (e) {
      this.enable = false
    }
    this.languageIds = config.filetypes || ['ruby']
  }

  public init(): Promise<any> {
    let {config, name} = this
    let applyConfiguration = (config: solargraph.Configuration) => {
      config.commandPath = config.commandPath || 'solargraph'
      config.useBundler = config.useBundler || false
      config.bundlerPath = config.bundlerPath || 'bundle'
      config.withSnippets = config.withSnippets || false
      config.workspace = workspace.root
    }
    let solargraphConfiguration = this.configurations = new solargraph.Configuration()
    applyConfiguration(solargraphConfiguration)
    let socketProvider = this.socketProvider = new solargraph.SocketProvider(solargraphConfiguration)
    return socketProvider.start().then(() => {
      logger.debug(socketProvider.port)
      let client = this.client = makeLanguageClient(
        config.filetypes,
        socketProvider
      )
      client.onDidChangeState(changeEvent => {
        let {oldState, newState} = changeEvent
        let oldStr = oldState == State.Running ? 'running' : 'stopped'
        let newStr = newState == State.Running ? 'running' : 'stopped'
        logger.info(`${name} state change: ${oldStr} => ${newStr}`)
      })
      Object.defineProperty(this, 'state', {
        get: () => {
          return client.serviceState
        }
      })
      client.registerProposedFeatures()
      let disposable = client.start()
      this.disposables.push(disposable)
      // let docuemntProvider = new DocumentProvider(client)
      if ((config as any).checkGemVersion === true) {
        checkGemVersion(solargraphConfiguration)
      }

      return new Promise(resolve => {
        client.onReady().then(() => {
          this.registerCommand()
          this._onDidServiceReady.fire(void 0)
          resolve()
        }, e => {
          echoErr(workspace.nvim, 'Solargraph failed to initialize.')
          logger.error(e.message)
          resolve()
        }
        )
      })
    }).catch(err => {
      logger.error('Failed to start language server: ' + err.stack)
      if (err.toString().includes('ENOENT') || err.toString().includes('command not found')) {
        echoErr(workspace.nvim, 'Solargraph gem not found. Run `gem install solargraph` or update your Gemfile.')
      } else if (err.toString().includes('Could not find command "socket"')) {
        echoErr(workspace.nvim, 'The Solargraph gem is out of date. Run `gem update solargraph` or update your Gemfile.')
      } else {
        echoErr(workspace.nvim, 'Failed to start Solargraph: ' + err)
      }
    })
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  public registerCommand(): void {
    // Search command
    let disposableSearch = commandManager.registerCommand('solargraph.search', () => {
      workspace.nvim.call('input', ['Search Ruby documentation:']).then(val => {
        if (val) {
          let uri = 'solargraph:/search?query=' + encodeURIComponent(val)
          commandManager.executeCommand('solargraph._openDocument', uri)
        }
      })
    })
    this.disposables.push(disposableSearch)

    // Check gem version command
    let disposableCheckGemVersion = commandManager.registerCommand('solargraph.checkGemVersion', () => {
      // languageClient.sendNotification('$/solargraph/checkGemVersion', { verbose: true });
      solargraph.verifyGemIsCurrent(this.configurations).then(result => {
        if (result) {
          echoMessage(workspace.nvim, 'The Solargraph gem is up to date.')
        } else {
          notifyGemUpdate()
        }
      }).catch(() => {
        echoErr(workspace.nvim, 'An error occurred checking the Solargraph gem version.')
      })
    })
    this.disposables.push(disposableCheckGemVersion)

    // Build gem documentation command
    let disposableBuildGemDocs = commandManager.registerCommand('solargraph.buildGemDocs', () => {
      this.client.sendNotification('$/solargraph/documentGems', {rebuild: false})
    })
    this.disposables.push(disposableBuildGemDocs)

    // Rebuild gems documentation command
    let disposableRebuildAllGemDocs = commandManager.registerCommand('solargraph.rebuildAllGemDocs', () => {
      this.client.sendNotification('$/solargraph/documentGems', {rebuild: true})
    })
    this.disposables.push(disposableRebuildAllGemDocs)

    // Solargraph configuration command
    let disposableSolargraphConfig = commandManager.registerCommand('solargraph.config', () => {
      let child = solargraph.commands.solargraphCommand(['config'], this.configurations)
      child.on('exit', code => {
        if (code == 0) {
          echoMessage(workspace.nvim, 'Created default .solargraph.yml file.')
        } else {
          echoErr(workspace.nvim, 'Error creating .solargraph.yml file.')
        }
      })
    })
    this.disposables.push(disposableSolargraphConfig)

    // Solargraph download core command
    let disposableSolargraphDownloadCore = commandManager.registerCommand('solargraph.downloadCore', () => {
      let child = solargraph.commands.solargraphCommand(['download-core'], this.configurations)
      child.on('exit', code => {
        if (code == 0) {
          echoMessage(workspace.nvim, 'Core documentation downloaded.')
        } else {
          echoErr(workspace.nvim, 'Error downloading core documentation.')
        }
      })
    })
    this.disposables.push(disposableSolargraphDownloadCore)
  }

  public async restart(): Promise<any> {
    let {client, config} = this
    if (!client) return
    if (this.state == ServiceStat.Running) {
      await this.stop()
    }
    return new Promise(resolve => {
      if (client) {
        this.dispose()
        this.socketProvider.restart().then(() => {
          let client = this.client = makeLanguageClient(config.filetypes, this.socketProvider)
          // solargraphDocumentProvider.setLanguageClient(languageClient);
          let disposable = this.client.start()
          this.disposables.push(disposable)
          client.onReady().then(() => {
            this._onDidServiceReady.fire(void 0)
            this.registerCommand()
            resolve()
          }, e => {
            echoErr(workspace.nvim, 'Solargraph failed to initialize.')
            logger.error(e.message)
            resolve()
          }
          )
        })
      } else {
        this.init().then(resolve, _e => {
          // noop
        })
      }
    })

  }

  public async stop(): Promise<void> {
    if (!this.client) return
    await Promise.resolve(this.client.stop())
  }
}

function checkGemVersion(configuration: solargraph.Configuration): void {
  logger.info('Checking gem version')
  solargraph.verifyGemIsCurrent(configuration).then(result => {
    if (result) {
      logger.info()('Solargraph gem version is current')
    } else {
      notifyGemUpdate()
    }
  })
    .catch(() => {
      logger.error('An error occurred checking the Solargraph gem version.')
    })
}

function notifyGemUpdate(): void {
  if (workspace.getConfiguration('solargraph').useBundler) {
    echoMessage(workspace.nvim, 'A new version of the Solargraph gem is available. Update your Gemfile to install it.')
  } else {
    echoMessage(workspace.nvim, 'A new version of the Solargraph gem is available. Run `gem update solargraph` to install it.')
  }
}
