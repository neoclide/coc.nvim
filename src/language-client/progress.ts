'use strict'
import type { ClientCapabilities, WorkDoneProgressCreateParams } from 'vscode-languageserver-protocol'
import { WorkDoneProgressCreateRequest } from '../util/protocol'
import { ensure, FeatureClient, FeatureState, StaticFeature } from './features'
import { ProgressPart } from './progressPart'

export class ProgressFeature implements StaticFeature {
  private activeParts: Set<ProgressPart> = new Set()
  constructor(private _client: FeatureClient<object>) {
  }

  public get method(): string {
    return WorkDoneProgressCreateRequest.method
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(capabilities, 'window')!.workDoneProgress = true
  }

  public getState(): FeatureState {
    return { kind: 'window', id: WorkDoneProgressCreateRequest.method, registrations: this.activeParts.size > 0 }
  }

  public initialize(): void {
    let client = this._client
    const deleteHandler = (part: ProgressPart) => {
      this.activeParts.delete(part)
    }
    const createHandler = (params: WorkDoneProgressCreateParams) => {
      this.activeParts.add(new ProgressPart(this._client, params.token, deleteHandler))
    }
    client.onRequest(WorkDoneProgressCreateRequest.type, createHandler)
  }

  public dispose(): void {
    for (const part of this.activeParts) {
      part.done()
    }
    this.activeParts.clear()
  }
}
