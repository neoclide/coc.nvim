/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { ClientCapabilities, WorkDoneProgressCreateParams, WorkDoneProgressCreateRequest } from 'vscode-languageserver-protocol'
import { BaseLanguageClient, StaticFeature } from './client'
import { ProgressPart } from './progressPart'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
	if (target[key] === void 0) {
		target[key] = Object.create(null) as any
	}
	return target[key]
}

export class ProgressFeature implements StaticFeature {
	constructor(private _client: BaseLanguageClient) { }

	public fillClientCapabilities(capabilities: ClientCapabilities): void {
		ensure(capabilities, 'window')!.workDoneProgress = true
	}

	public initialize(): void {
		let client = this._client

		let createHandler = (params: WorkDoneProgressCreateParams) => {
			new ProgressPart(this._client, params.token)
		}
		client.onRequest(WorkDoneProgressCreateRequest.type, createHandler)
	}
}