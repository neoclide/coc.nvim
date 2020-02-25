/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, Disposable, NotificationHandler, NotificationType, ProgressToken, ProgressType, WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressCancelNotification, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import * as Is from '../util/is'

export interface ProgressContext {
	onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
	sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
}

export class ProgressPart {

	private _infinite: boolean
	private _reported: number
	// TODO
	// private _progress: Progress<{ message?: string, increment?: number }>
	private _progress: any
	private _cancellationToken: CancellationToken
	private _disposable: Disposable | undefined

	private _resolve: (() => void) | undefined
	private _reject: ((reason?: any) => void) | undefined

	public constructor(private _client: ProgressContext, private _token: ProgressToken) {
		this._reported = 0
		this._disposable = this._client.onProgress(WorkDoneProgress.type, this._token, value => {
			switch (value.kind) {
				case 'begin':
					this.begin(value)
					break
				case 'report':
					this.report(value)
					break
				case 'end':
					this.done()
					break
			}
		})
	}

	private begin(params: WorkDoneProgressBegin): void {
		// TODO
		console.error(`progressPart begin: ${params}`) // tslint:disable-line
		// let location: ProgressLocation = params.cancellable ? ProgressLocation.Notification : ProgressLocation.Window
		// Window.withProgress<void>({ location, cancellable: params.cancellable, title: params.title }, async (progress, cancellationToken) => {
		// 	this._progress = progress;
		// 	this._infinite = params.percentage === undefined;
		// 	this._cancellationToken = cancellationToken;
		// 	this._cancellationToken.onCancellationRequested(() => {
		// 		this._client.sendNotification(WorkDoneProgressCancelNotification.type, { token: this._token });
		// 	});
		// 	this.report(params);
		// 	return new Promise<void>((resolve, reject) => {
		// 		this._resolve = resolve;
		// 		this._reject = reject;
		// 	});
		// });
	}

	private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
		if (this._infinite && Is.string(params.message)) {
			this._progress.report({ message: params.message })
		} else if (Is.number(params.percentage)) {
			let percentage = Math.max(0, Math.min(params.percentage, 100))
			let delta = Math.max(0, percentage - this._reported)
			this._progress.report({ message: params.message, increment: delta })
			this._reported += delta
		}
	}

	public cancel(): void {
		if (this._disposable) {
			this._disposable.dispose()
			this._disposable = undefined
		}
		if (this._reject) {
			this._reject()
			this._resolve = undefined
			this._reject = undefined
		}
	}

	public done(): void {
		if (this._disposable) {
			this._disposable.dispose()
			this._disposable = undefined
		}
		if (this._resolve) {
			this._resolve()
			this._resolve = undefined
			this._reject = undefined
		}
	}
}