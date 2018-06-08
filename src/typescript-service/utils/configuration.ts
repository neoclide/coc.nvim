import {
  WorkspaceConfiguration
} from '../../types'
import workspace from '../../workspace'

export enum TsServerLogLevel {
  Off,
  Normal,
  Terse,
  Verbose
}

export namespace TsServerLogLevel {
  export function fromString(value: string): TsServerLogLevel {
    switch (value && value.toLowerCase()) {
      case 'normal':
        return TsServerLogLevel.Normal
      case 'terse':
        return TsServerLogLevel.Terse
      case 'verbose':
        return TsServerLogLevel.Verbose
      case 'off':
      default:
        return TsServerLogLevel.Off
    }
  }

  export function toString(value: TsServerLogLevel): string {
    switch (value) {
      case TsServerLogLevel.Normal:
        return 'normal'
      case TsServerLogLevel.Terse:
        return 'terse'
      case TsServerLogLevel.Verbose:
        return 'verbose'
      case TsServerLogLevel.Off:
      default:
        return 'off'
    }
  }
}

export class TypeScriptServiceConfiguration {
  public readonly locale: string | null
  public readonly globalTsdk: string | null
  public readonly localTsdk: string | null
  public readonly npmLocation: string | null
  public readonly tsServerLogLevel: TsServerLogLevel
  public readonly checkJs: boolean
  public readonly experimentalDecorators: boolean
  public readonly disableAutomaticTypeAcquisition: boolean
  public readonly tsServerPluginNames: string[]
  public readonly tsServerPluginRoot: string | null
  private constructor() {
    const configuration = workspace.getConfiguration('typescript')
    this.locale = configuration.get<string | null>('locale', null)
    this.globalTsdk = TypeScriptServiceConfiguration.extractGlobalTsdk(configuration)
    this.localTsdk = TypeScriptServiceConfiguration.extractLocalTsdk(configuration)
    this.npmLocation = configuration.get<string>('npm', null)
    this.tsServerLogLevel = TsServerLogLevel.fromString(configuration.get<string>('tsserver.log', 'off'))
    this.tsServerPluginNames = configuration.get<string[]>('pluginNames', [])
    this.tsServerPluginRoot = configuration.get<string>('pluginRoot', null)
    this.checkJs = configuration.get<boolean>('implicitProjectConfig.checkJs', false)
    this.experimentalDecorators = configuration.get<boolean>('implicitProjectConfig.experimentalDecorators', false)
    this.disableAutomaticTypeAcquisition = configuration.get<boolean>('disableAutomaticTypeAcquisition', false)
  }

  private static extractGlobalTsdk(configuration: WorkspaceConfiguration): string | null {
    const inspect = configuration.inspect('tsdk')
    if ( inspect
      && inspect.globalValue
      && (inspect.globalValue as string).length
      && 'string' === typeof inspect.globalValue) {
      return inspect.globalValue
    }
    return null
  }

  private static extractLocalTsdk(configuration: WorkspaceConfiguration): string | null {
    const inspect = configuration.inspect('tsdk')
    if ( inspect
      && inspect.folderValue
      && (inspect.folderValue as string).length
      && 'string' === typeof inspect.folderValue) {
      return inspect.folderValue
    }
    return null
  }

  public static loadFromWorkspace(): TypeScriptServiceConfiguration {
    return new TypeScriptServiceConfiguration()
  }
}
