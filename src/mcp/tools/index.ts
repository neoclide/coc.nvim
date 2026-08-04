'use strict'
import { CancellationToken, Disposable, Emitter, Event } from '../../util/protocol'

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolContext {
  token: CancellationToken
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface McpToolResult {
  content: TextContent[]
  structuredContent?: any
  isError?: boolean
}

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, any>
  outputSchema?: Record<string, any>
  annotations?: ToolAnnotations
  handler(args: any, context: ToolContext): Promise<McpToolResult> | McpToolResult
}

export interface ToolInfo {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, any>
  outputSchema?: Record<string, any>
  annotations?: ToolAnnotations
}

export function toToolInfo(tool: McpTool): ToolInfo {
  let info: ToolInfo = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
  if (tool.title) info.title = tool.title
  if (tool.outputSchema) info.outputSchema = tool.outputSchema
  if (tool.annotations) info.annotations = tool.annotations
  return info
}

export class ToolRegistry implements Disposable {
  private tools = new Map<string, McpTool>()
  private allowed: Set<string> | null = null
  private _onDidChange = new Emitter<void>()
  public readonly onDidChange: Event<void> = this._onDidChange.event

  /**
   * Restrict exposed tools to a whitelist of names. `null` allows every
   * registered tool; an empty set exposes none. Tools outside the whitelist
   * are hidden from `tools/list` and rejected by `has`/`get`/`call`.
   */
  public setAllowedTools(names: string[] | null): void {
    this.allowed = names ? new Set(names) : null
    this._onDidChange.fire()
  }

  public isAllowed(name: string): boolean {
    return this.allowed === null || this.allowed.has(name)
  }

  public register(tool: McpTool): Disposable {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`)
    }
    this.tools.set(tool.name, tool)
    this._onDidChange.fire()
    return Disposable.create(() => {
      this.unregister(tool.name)
    })
  }

  public unregister(name: string): void {
    if (this.tools.delete(name)) {
      this._onDidChange.fire()
    }
  }

  public get(name: string): McpTool | undefined {
    let tool = this.tools.get(name)
    return tool && this.isAllowed(name) ? tool : undefined
  }

  public has(name: string): boolean {
    return this.isAllowed(name) && this.tools.has(name)
  }

  public list(): { tools: ToolInfo[] } {
    let tools: ToolInfo[] = []
    for (let tool of this.tools.values()) {
      if (!this.isAllowed(tool.name)) continue
      tools.push(toToolInfo(tool))
    }
    return { tools }
  }

  public async call(name: string, args: any, context: ToolContext): Promise<McpToolResult> {
    let tool = this.get(name)
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`)
    }
    return await Promise.resolve(tool.handler(args, context))
  }

  public dispose(): void {
    this.tools.clear()
    this._onDidChange.dispose()
  }
}
