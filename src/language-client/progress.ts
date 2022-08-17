'use strict'
import { ClientCapabilities, WorkDoneProgressCreateParams, WorkDoneProgressCreateRequest } from 'vscode-languageserver-protocol'
import { ProgressPart } from './progressPart'
import { FeatureState, StaticFeature, ensure, FeatureClient } from './features'
// const logger = require('../util/logger')('language-client-progress')

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
