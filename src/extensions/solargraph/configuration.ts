
export class Configuration {
  private _workspace: string
  private _useBundler: Boolean
  private _bundlerPath: string
  private _commandPath: string
  private _withSnippets: Boolean
  private _viewsPath: string

  public constructor(workspace: string = null, useBundler: Boolean = false, bundlerPath = "bundle", commandPath = 'solargraph', withSnippets: Boolean = false, viewsPath: string = null) {
    this._workspace = workspace
    this._useBundler = useBundler
    this._bundlerPath = bundlerPath
    this._commandPath = commandPath
    this._withSnippets = withSnippets
    this._viewsPath = viewsPath
  }

  public get workspace(): string {
    return this._workspace
  }

  public set workspace(path: string) {
    this._workspace = path
  }

  public get useBundler(): Boolean {
    return this._useBundler
  }

  public set useBundler(bool: Boolean) {
    this._useBundler = bool
  }

  public get bundlerPath(): string {
    return this._bundlerPath
  }

  public set bundlerPath(path: string) {
    this._bundlerPath = path
  }

  public get commandPath(): string {
    return this._commandPath
  }

  public set commandPath(path: string) {
    this._commandPath = path
  }

  public get withSnippets(): Boolean {
    return this._withSnippets
  }

  public set withSnippets(bool: Boolean) {
    this._withSnippets = bool
  }

  public get viewsPath(): string {
    return this._viewsPath
  }

  public set viewsPath(path: string) {
    this._viewsPath = path
  }
}
