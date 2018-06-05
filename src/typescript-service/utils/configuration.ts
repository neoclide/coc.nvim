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
  public readonly npmLocation: string | null
  public readonly tsServerLogLevel: TsServerLogLevel
  public readonly checkJs: boolean
  public readonly experimentalDecorators: boolean
  public readonly disableAutomaticTypeAcquisition: boolean
  public readonly tsServerPluginNames: string[]
  public readonly tsServerPluginRoot: string | null
  private constructor() {
    // typescript.locale
    this.locale = null
    // typescript.tsdk folder contains tsserver.js
    this.globalTsdk = null
    // typescript.npmLocation
    this.npmLocation = null
    // typescript.tsserver.logLevel
    this.tsServerLogLevel = TsServerLogLevel.fromString(process.env.TSS_LOG_LEVEL)
    // typescript.tsserver.plugin.names
    this.tsServerPluginNames = []
    // typescript.tsserver.plugin.root
    this.tsServerPluginRoot = ''
    // typescript.implicitProjectConfig.checkJs
    this.checkJs = false
    // typescript.implicitProjectConfig.experimentalDecorators
    this.experimentalDecorators = false
    // typescript.disableAutomaticTypeAcquisition
    this.disableAutomaticTypeAcquisition = false
  }

  public static loadFromWorkspace(): TypeScriptServiceConfiguration {
    return new TypeScriptServiceConfiguration()
  }
}
