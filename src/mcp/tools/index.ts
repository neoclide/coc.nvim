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
  private _onDidChange = new Emitter<void>()
  public readonly onDidChange: Event<void> = this._onDidChange.event

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
    return this.tools.get(name)
  }

  public has(name: string): boolean {
    return this.tools.has(name)
  }

  public list(): { tools: ToolInfo[] } {
    let tools: ToolInfo[] = []
    for (let tool of this.tools.values()) {
      tools.push(toToolInfo(tool))
    }
    return { tools }
  }

  public async call(name: string, args: any, context: ToolContext): Promise<McpToolResult> {
    let tool = this.tools.get(name)
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
