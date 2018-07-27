
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

  get workspace(): string {
    return this._workspace
  }

  set workspace(path: string) {
    this._workspace = path
  }

  get useBundler(): Boolean {
    return this._useBundler
  }

  set useBundler(bool: Boolean) {
    this._useBundler = bool
  }

  get bundlerPath(): string {
    return this._bundlerPath
  }

  set bundlerPath(path: string) {
    this._bundlerPath = path
  }

  get commandPath(): string {
    return this._commandPath
  }

  set commandPath(path: string) {
    this._commandPath = path
  }

  get withSnippets(): Boolean {
    return this._withSnippets
  }

  set withSnippets(bool: Boolean) {
    this._withSnippets = bool
  }

  get viewsPath(): string {
    return this._viewsPath
  }

  set viewsPath(path: string) {
    this._viewsPath = path
  }
}
