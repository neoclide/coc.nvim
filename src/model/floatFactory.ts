import { Buffer, Neovim, Window } from "@chemzqm/neovim";
import { CancellationTokenSource, Disposable, Emitter, Event } from "vscode-languageserver-protocol";
import events from "../events";
import snippetsManager from "../snippets/manager";
import { Documentation, Env } from "../types";
import { disposeAll } from "../util";
import workspace from "../workspace";
import FloatBuffer from "./floatBuffer";
const logger = require("../util/logger")("model-float")

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
}

// factory class for floating window
export default class FloatFactory implements Disposable {
  private buffer: Buffer
  private targetBufnr: number
  private window: Window
  private readonly _onWindowCreate = new Emitter<Window>()
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private promise: Promise<void> = Promise.resolve(undefined)
  private createTs: number
  private alignTop = false
  private _creating = false
  public readonly onWindowCreate: Event<Window> = this._onWindowCreate.event
  constructor(
    private nvim: Neovim,
    private env: Env,
    private srcId: number,
    private forceTop = false
  ) {
    if (!env.floating) return
    events.on(
      "InsertEnter",
      async () => {
        this.close()
      },
      null,
      this.disposables
    )
    events.on(
      "BufEnter",
      async bufnr => {
        if (this.buffer && bufnr == this.buffer.id) return
        if (bufnr == this.targetBufnr) return
        this.close()
      },
      null,
      this.disposables
    )
    events.on(
      "CursorMoved",
      async bufnr => {
        if (this.buffer && bufnr == this.buffer.id) return
        if (this.creating) return
        this.close()
      },
      null,
      this.disposables
    )
    events.on(
      "InsertLeave",
      async () => {
        this.close()
      },
      null,
      this.disposables
    )
    events.on(
      "MenuPopupChanged",
      async (ev, cursorline) => {
        if (cursorline < ev.row && !this.alignTop) {
          this.close()
        } else if (cursorline > ev.row && this.alignTop) {
          this.close()
        }
      },
      null,
      this.disposables
    )
  }

  private async createBuffer(): Promise<void> {
    if (this.buffer) return
    let buf = await this.nvim.createNewBuffer(false, true)
    this.buffer = buf
    await buf.setOption("buftype", "nofile")
    await buf.setOption("bufhidden", "hide")
    this.floatBuffer = new FloatBuffer(buf, this.nvim, this.srcId)
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async getBoundings(docs: Documentation[]): Promise<WindowConfig> {
    let { nvim, forceTop } = this
    let { columns, lines } = this
    let alignTop = false
    let offsetX = 0
    let [row, col] = (await nvim.call("coc#util#win_position")) as [
      number,
      number
    ]
    if (forceTop && row <= 5) {
      forceTop = false
    }
    await this.floatBuffer.setDocuments(docs, 60)
    let { height, width } = this.floatBuffer
    if (forceTop || (lines - row < height && row > height)) {
      alignTop = true
    }
    if (col + width > columns) {
      offsetX = col + width - columns
    }
    this.alignTop = alignTop
    return {
      height: alignTop ? Math.min(row, height) : Math.min(height, lines - row),
      width: Math.min(columns, width),
      row: alignTop ? -height : 1,
      col: offsetX == 0 ? 0 : -offsetX
    }
  }

  public create(docs: Documentation[]): Promise<void> {
    if (!this.env.floating) return
    this.targetBufnr = workspace.bufnr
    this.close()
    this._creating = true
    let promise = (this.promise = this.promise.then(() => {
      return this._create(docs).then(
        () => {
          this._creating = false
        },
        e => {
          logger.error("Error on create float window:", e)
          this._creating = false
        }
      )
    }))
    return promise
  }

  private async _create(docs: Documentation[]): Promise<Window | undefined> {
    if (docs.length == 0) return
    let tokenSource = (this.tokenSource = new CancellationTokenSource())
    let token = tokenSource.token
    if (!this.buffer) await this.createBuffer()
    let config = await this.getBoundings(docs)
    if (!config || token.isCancellationRequested) return
    let mode = await this.nvim.call("mode")
    let allowSelection =
      mode == "s" && snippetsManager.session && this.forceTop
    if (token.isCancellationRequested) return
    if (["i", "n", "ic"].indexOf(mode) !== -1 || allowSelection) {
      let { nvim, forceTop } = this
      if (mode == "s") await nvim.call("feedkeys", ["\x1b", "in"])
      let window = await this.nvim.openFloatWindow(this.buffer, false, {
        width: config.width,
        height: config.height,
        col: config.col,
        row: config.row,
        relative: "cursor"
      })
      if (token.isCancellationRequested) {
        this.closeWindow(window)
        return
      }
      this.window = window
      this._onWindowCreate.fire(window)
      nvim.pauseNotification()
      window.setVar("float", 1, true)
      window.setCursor([1, 1], true)
      window.setOption("list", false, true)
      window.setOption("wrap", false, true)
      window.setOption("previewwindow", true, true)
      window.setOption("number", false, true)
      window.setOption("cursorline", false, true)
      window.setOption("cursorcolumn", false, true)
      window.setOption("signcolumn", "no", true)
      window.setOption("conceallevel", 2, true)
      window.setOption("relativenumber", false, true)
      window.setOption(
        "winhl",
        `Normal:CocFloating,NormalNC:CocFloating`,
        true
      )
      nvim.call("win_gotoid", [window.id], true)
      this.floatBuffer.setLines()
      if (forceTop) nvim.command("normal! G", true)
      nvim.command("wincmd p", true)
      await nvim.resumeNotification()
      if (mode == "s") {
        await snippetsManager.selectCurrentPlaceholder(false)
      }
      this.createTs = Date.now()
    }
  }

  /**
   * Close float window
   */
  public close(): void {
    if (!this.env.floating) return
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
    this.closeWindow(this.window)
  }

  private closeWindow(window: Window): void {
    if (!window) return
    this.nvim.call("coc#util#close_win", window.id, true)
    this.window = null
    let count = 0
    let interval = setInterval(() => {
      count++
      if (count == 5) clearInterval(interval)
      window.valid.then(valid => {
        if (valid) {
          this.nvim.call("coc#util#close_win", window.id, true)
        } else {
          clearInterval(interval)
        }
      })
    }, 200)
  }

  public dispose(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
    }
    this._onWindowCreate.dispose()
    disposeAll(this.disposables)
  }

  public get creating(): boolean {
    if (this.createTs && Date.now() - this.createTs < 30) return true
    return this._creating
  }
}
