─── lua/coc/vtext.lua:8-8 ───
✅ resolved — `right_gravity` is only set on the `virt_text` path; regression test added for
virt_lines (`text_align: 'above'`) with `right_gravity`
[bug · medium] `right_gravity` is set unconditionally on the config, but it is only valid for
`virt_text`. When `text_align` is 'above'/'below', the `virt_lines` branch is used and Neovim's
`nvim_buf_set_extmark` does not support `right_gravity` with `virt_lines` (only `false` is allowed)
— passing `right_gravity = true` makes the API call fail. Since the call is wrapped in `pcall`, the
error is swallowed and the virtual text silently disappears. Consider setting `right_gravity` only
when it is non-nil and not on the virt_lines path.

-     local config = { hl_mode = opts.hl_mode or 'combine', right_gravity = opts.right_gravity }
+     local config = { hl_mode = opts.hl_mode or 'combine' }
+     if opts.right_gravity ~= nil and align ~= 'above' and align ~= 'below' then
+       config.right_gravity = opts.right_gravity
+     end


─── lua/coc/init.lua:34-40 ───
⏭️ skipped — design decision: exposing an async variant or documenting the blocking behavior
needs user confirmation
[performance · medium] These wrappers use `vim.rpcrequest`, which is a synchronous blocking call
that freezes the Neovim UI until the Node side replies. `getWorkspaceSymbols`, `getDocumentSymbols`,
and `runCommand` can involve language-server round-trips or slow user commands (e.g.
`coc#rpc#async_request` is used elsewhere in this codebase precisely to avoid blocking for such
operations). There is no timeout or cancellation: a slow or hung language server will block the
editor indefinitely and the wrapper will only return `nil` afterwards. Consider documenting this
blocking limitation on the module, or exposing an async variant for the slow operations.



─── lua/coc/init.lua:15-18 ───
⏭️ skipped — design decision: changing the return contract or surfacing errors via notify changes
extension-facing behavior and needs user confirmation
[maintainability · low] The `pcall` swallows every failure (channel closed, plugin not ready, action
error, server error) and collapses it to `nil`, discarding the underlying error message. Callers
therefore cannot distinguish a genuine empty result from a failed request, which makes debugging
broken integrations very hard — especially combined with the blocking behavior above. Consider
returning the error as a second return value (e.g. `return nil, err`), or at least surfacing it
through `vim.notify`/logging so silent failures don't hide real service bugs.



─── src/core/fileSystemWatcher.ts:28-28 ───
✅ resolved — `disabled` now keeps `config.enable === false || global.__TEST__ || isTester` (test added)
[bug · medium] The `|| isTester` addition has no runtime effect: the field initializer
`global.__TEST__ || isTester` is always overwritten in the constructor by `this.disabled =
config.enable === false` (class field initializers run before the constructor body). As a result,
the intent to disable the file system watcher under the tester environment (`COC_TESTER=1`) is not
fulfilled. Consider merging the check into the constructor, e.g. `this.disabled = config.enable ===
false || global.__TEST__ || isTester`, or use this combined condition in `createClient` where
`this.disabled` is consumed.



─── src/core/workspaceFolder.ts:89-91 ───
✅ resolved — not reproducible: `getConfiguration()` mixes the raw config record into the wrapper
(methods are non-enumerable), so `Object.values()` yields the actual server configs; the existing
`should add patterns from languageserver` test passes without changes
[bug · high] `getConfiguration('languageserver', null)` returns a `WorkspaceConfiguration` wrapper
(an object exposing only `has`/`get`/`update` methods), not the raw languageserver configuration
record. Iterating `Object.values()` over it yields those three method functions, so `{ filetypes,
rootPatterns }` is always `undefined`/non-array and `rootPatterns` ends up empty after `clear()`.
This silently breaks language-server root pattern detection (workspace folder resolution). Fetch the
raw record instead, e.g. `this.configurations.getConfiguration('languageserver',
null).get<Record<string, LanguageServerConfig>>()` or
`this.configurations.initialConfiguration.get<Record<string,
LanguageServerConfig>>('languageserver', {})`, as the previous `addServerRootPatterns`
implementation did.

-     let lspConfig = this.configurations.getConfiguration('languageserver', null)
+     let lspConfig = this.configurations.getConfiguration('languageserver', null).get<Record<string, LanguageServerConfig>>()
      this.rootPatterns.clear()
      for (let config of Object.values(toObject<Record<string, LanguageServerConfig>>(lspConfig))) {


─── src/core/notifications.ts:168-168 ───
✅ resolved — cancel (`res < 0`) returns `undefined`; signature updated to `Promise<T | undefined>` (test added)
[bug · medium] `Dialogs.showMenuPicker` returns `-1` when the menu is cancelled/dismissed (see
`src/model/menu.ts` firing `-1` and `src/core/dialogs.ts:102` for token cancellation). In that case
`items[-1]` evaluates to `undefined` at runtime, violating the declared `Promise<T>` return type.
This propagates as `undefined` into `_showMessage`, and callers relying on a valid item may
misbehave. Handle the cancel case explicitly (e.g., return `undefined` when `res < 0`) and update
the signature to `Promise<T | undefined>` so the contract is honest.

+     if (res < 0) return undefined
      return items[res]


─── src/core/notifications.ts:83-83 ───
✅ resolved — already fixed: `_history` is trimmed to `historyLimit` (100) after each push
[performance · medium] Every call to `_showMessage` appends an entry to `_history` with no size cap
or pruning. In a long-lived Neovim session with frequent info/warning/error messages this array
grows without bound and leaks memory. Consider trimming to a maximum length (e.g., keep the most
recent N entries) after each push.

      this._history.push({ time: this.getCurrentTimestamp(), kind, message })
+     if (this._history.length > 1000) this._history.shift()


─── src/core/notifications.ts:165-165 ───
✅ resolved — global replace normalizes all line breaks (test added)
[maintainability · low] `title.replace(/\r?\n/, ' ')` only replaces the first newline sequence, so
multi-line titles retain the remaining line breaks in the menu title. Use a global replace
`title.replace(/\r?\n/g, ' ')` to normalize all line breaks.

-       title: title.replace(/\r?\n/, ' '),
+       title: title.replace(/\r?\n/g, ' '),


─── src/core/documents.ts:563-566 ───
⏭️ skipped — needs user confirmation: OR semantics between `formatOnSaveFiletypes` and
`formatOnSave` may be intentional (changed in #5588)
[bug · medium] Behavior change: the new `enabledInConfiguration` uses OR semantics, so a global
`coc.preferences.formatOnSave: true` will now enable format-on-save for *every* filetype even when
`formatOnSaveFiletypes` is set to a whitelist that excludes the current language. Previously (see
deleted lines), when `formatOnSaveFiletypes` was an array it was the sole gate and `formatOnSave`
was ignored, so this change silently overrides users' filetype exclusions and can cause unexpected
auto-formatting. Please confirm this is intentional; otherwise keep the original precedence where a
non-empty `formatOnSaveFiletypes` list takes priority over `formatOnSave`.



─── src/core/documents.ts:562-562 ───
✅ resolved — `Array.isArray` guard restored so non-array values neither throw nor substring-match (test added)
[bug · low] The previous code guarded `formatOnSaveFiletypes` with `Array.isArray` before calling
`.includes`. The new `?? []` only handles `null`/`undefined`; if a user misconfigures the value as a
string, `.includes` will do substring matching, and a number/object will throw a TypeError, breaking
format-on-save. Consider restoring the `Array.isArray` check or normalizing the value to an array.



─── src/core/watchman.ts:103-103 ───
✅ resolved — replaced the suppression with an explicit `FileChange` cast; verified the directive
was suppressing a real type error (SubscriptionResponse vs FileChange)
[maintainability · medium] This `@ts-expect-error` bypasses the type check when passing the raw
watchman subscription response to the `FileChange` listener. The `subscription` callback parameter
(`resp`) is untyped `any` (inherited from `EventEmitter`), so `listener(resp)` may not actually
raise a compile error — and if the directive doesn't suppress a real error, `tsc` fails with TS2578
"Unused '@ts-expect-error' directive", breaking the `lint:typecheck` build. Prefer annotating the
callback parameter as `FileChange` (or casting) instead of suppressing, and if the suppression is
truly required, use a comment that explains the actual mismatch.



─── src/core/watchman.ts:112-112 ───
✅ resolved — verified by removing the directive: a real TS2769 overload error appears, so it is
kept with a comment explaining the dynamic-args mismatch
[maintainability · medium] Same concern as the directive above: `this.client.command()` is a typed
method whose signature accepts `any[]` args and an `(error, resp)` callback, so this directive
likely isn't suppressing a real error and may trigger TS2578 "Unused '@ts-expect-error' directive"
under `tsc`, failing the typecheck step. Also, the comment "any type" doesn't explain what issue it
addresses. Verify by temporarily removing the directive; if no error appears, delete it rather than
leaving a potentially build-breaking suppression.



─── src/completion/source-language.ts:169-169 ───
✅ resolved — intentional: the guard was added by fix #5577 ("invalid range end") with the
regression test "should not eat existing paired character on valid range"; keeping it preserves
that behavior, and dropping it would regress #5577
[bug · medium] The newly added `invalidRangeEnd` guard narrows the paired-character range extension
(`range.end.character += 1`) to only the case where the range was shorter than the cursor. However,
in the common insert-mode path the default replace range ends exactly at the cursor (`end =
character` for `InsertMode.Insert`, see line 156), so `range.end.character == character` makes
`invalidRangeEnd` false. In that case the following closing bracket (e.g., an autopaired `)`) is no
longer consumed by the replacement, which can leave a duplicated closing character such as `())`. If
this narrowing is intentional it should be justified and covered by a test; otherwise the guard
should be dropped to preserve the original behavior.

-     if (invalidRangeEnd && next && newText.endsWith(next) && pariedCharacters.get(newText[0]) === next) {
+     if (next && newText.endsWith(next) && pariedCharacters.get(newText[0]) === next) {


─── src/diagnostic/manager.ts:323-324 ───
✅ resolved — duplicated jump logic extracted into `showVirtualTextAndResetTimer`
[maintainability · low] These two lines (show virtual text at the target line and clear the pending
message timer) are duplicated verbatim in both `jumpPrevious` and `jumpNext`. Consider extracting
them into a shared helper (e.g., `showVirtualTextAndResetTimer(item, pos)`) to keep the jump logic
consistent and reduce duplication.



─── src/extension/installer.ts:299-309 ───
✅ resolved — extension dependencies are installed before the main extension is moved into place,
so a dependency failure cleans up the download instead of leaving a partial install (test added)
[bug · medium] Extension dependencies are installed only *after* the main extension has already been
moved into place at `dest`. If `installer.getInfo()` or `installer.doInstall()` fails for any
dependency, the exception propagates up through `install()`/`update()` and the whole operation is
reported as failed — yet the main extension is already on disk, leaving a partially-installed state
that is hard to recover from (a retry will re-download and overwrite it, while the failed dependency
remains uninstalled). Consider installing the extension dependencies before renaming
`downloadFolder` into `dest`, or at least catch dependency errors and surface a clear user-friendly
message instead of aborting the already-completed main install.



─── src/extension/installer.ts:267-271 ───
✅ resolved — skip message now says "already installed or in progress" instead of claiming a
circular dependency (test added)
[maintainability · low] The `installing` set is only ever added to and never cleaned up, so it
conflates "currently being installed" with "already installed". In a non-circular shared-dependency
graph (e.g. A depends on B and C, and both B and C depend on D), the second occurrence of D is
skipped and logged as `Skipping circular dependency: D`, which is misleading since it isn't a
circular dependency — D is just already installed. This works by accident (dedup), but the log
message is inaccurate for users. Consider removing the name from the set in a `finally` block so it
reflects only in-progress installs, or reword the message to reflect "already installed/skipped"
semantics.



─── src/extension/installer.ts:278-278 ───
✅ resolved — `obj` typed as `{ dependencies?, extensionDependencies? }`
[maintainability · low] Avoid `any` here. `obj` only needs to be consumed by `getDependencies` and
`getExtensionDependencies`, which require at most `{ dependencies?: Record<string,string>;
extensionDependencies?: string[] }`. Declaring a precise type would keep the rest of the function
type-safe instead of widening to `any`.



─── src/handler/inline.ts:270-270 ───
✅ resolved — strict inequality
[style · low] Use strict inequality (`!==`) instead of loose `!=`. Besides violating the project's
strict-equality rule, note this also changes the original behavior: the previous check
`!state.mode.startsWith('i')` accepted modes like `'ic'`/`'ix'` (insert completion), while `mode !=
'i'` now only accepts the exact `'i'` mode, which may suppress triggering during insert-completion
states.

- if (disable || nr !== bufnr || mode != 'i' || token.isCancellationRequested) return false
+ if (disable || nr !== bufnr || mode !== 'i' || token.isCancellationRequested) return false


─── src/handler/inline.ts:269-269 ───
✅ resolved — eval result typed as a strict tuple
[maintainability · low] The `as any` cast discards type safety for the eval result. Consider typing
the tuple explicitly (as done in `src/handler/highlights.ts` and `src/handler/index.ts`), e.g. `as
[string, number, [number, number], number]`, so `pos[0]`/`pos[1]` and `mode`/`nr` are statically
checked.

- let [mode, nr, pos, disable] = await this.nvim.eval('[mode(),bufnr("%"),coc#cursor#position(),get(b:,"coc_inline_disable",0)]') as any
+ let [mode, nr, pos, disable] = await this.nvim.eval('[mode(),bufnr("%"),coc#cursor#position(),get(b:,"coc_inline_disable",0)]') as [string, number, [number, number], number]


─── src/extension/manager.ts:277-283 ───
✅ resolved — the failed dependency's name and rejection reason are logged (test added)
[maintainability · medium] When a dependency fails, `Promise.allSettled` discards the rejection
reason and the loop only logs a generic message that doesn't name the failed dependency. For
example, if a dependency isn't registered, `this.activate(dep)` rejects with `Extension ${dep} not
registered!`, but `result.reason` is never surfaced — so the user/developer can't tell which
dependency blocked activation. Note this is also a behavior change: a
listed-but-uninstalled/unregistered dependency now blocks the parent extension's activation
entirely. Consider logging `result.reason` (and the dep name) so failures are diagnosable.



─── src/extension/manager.ts:265-265 ───
✅ resolved — recursive activation logic extracted into a private `activateWithSet`; public
`activate(id)` keeps a clean single-argument signature
[maintainability · low] The `activating` set is an internal recursion-tracking detail, yet it's
exposed as a second parameter on the public `activate` method. Since the same set object is shared
by reference across all parallel sibling activations inside `Promise.allSettled`, correctness
depends on each recursion reassigning it (`activating = new Set([...])`) rather than mutating it — a
subtle invariant. Consider extracting the recursive logic into a private method (e.g.,
`activateWithSet`) and keeping the public `activate(id)` signature clean, which also avoids the risk
of external callers passing a shared set.



─── src/completion/complete.ts:130-130 ───
⏭️ skipped — needs user confirmation: `s.sourceType === SourceType.Service` would also match plain
`createSource` sources (defaults to Service), keeping completion alive on backspace for word/snippet
sources; the existing tests "should stop completion when trigger source is not active" and "should
start new completion after backspace clears input" (#5705) guard the current narrower behavior
[maintainability · low] `getBackspaceSources` uses `s instanceof LanguageSource` to decide whether a
service source should be re-fetched on backspace. This couples the generic completion engine (which
operates on `ISource<CompleteItem>[]`) to a concrete class and will silently miss any other
`SourceType.Service` source that isn't literally a `LanguageSource` instance (e.g., extension/remote
service sources), causing inconsistent backspace behavior. Prefer the interface-level check
`s.sourceType === SourceType.Service` (stable field on `ISource`), which is more robust and requires
importing `SourceType` instead of the concrete class.

-     return sources.some(s => this.results.get(s.name)?.isIncomplete === true || s instanceof LanguageSource) ? sources : []
+     return sources.some(s => this.results.get(s.name)?.isIncomplete === true || s.sourceType === SourceType.Service) ? sources : []


─── src/completion/complete.ts:357-358 ───
✅ resolved — re-trigger restricted to growing input or backspace-cleared input, avoiding extra LSP
requests on plain prefix-trimming edits (test added)
[bug · low] The re-trigger condition was widened from `input.length > this.option.input.length`
(only when input grew) to `input !== this.option.input`. In the `backspace === false` path (e.g.,
deleting to a still non-empty word, or other non-insertChar edits), this now also re-fires
`completeInComplete` and sends `TriggerForIncompleteCompletions` requests whenever incomplete
sources exist and the prefix merely shrank, which was previously avoided. If the intent was only to
re-fetch on growing input and on backspace-to-empty, this adds extra LSP requests on every
prefix-trimming edit; otherwise consider restricting the condition to the backspace case explicitly.



─── src/handler/signature.ts:68-75 ───
✅ resolved — the deferred callback body is wrapped in try/catch and errors are logged
[bug · medium] The async callback passed to `process.nextTick` is never awaited by the event emitter
and has no try/catch or `.catch()`. Both `this.handler.getCurrentState()` and
`this._triggerSignatureHelp(...)` can reject: `getCurrentState()` internally calls
`workspace.getAttachedDocument()`, which throws when the current buffer doesn't exist or isn't
attached (also on RPC/nvim eval failures), and `_triggerSignatureHelp` may reject if the language
server errors. Any rejection here becomes an unhandled promise rejection, which can crash the
process on Node >= 15. Wrap the body in try/catch and log the error (matching how other handler
errors are surfaced), or attach `.catch()`.



─── src/handler/signature.ts:66-67 ───
✅ resolved — comment added explaining the MenuPopupChanged re-trigger flow and hideOnChange gate
[maintainability · low] The purpose of this handler is non-obvious: when the completion popup is
shown, `FloatFactory` closes the signature float on `MenuPopupChanged` to avoid intersecting with
the pum (see `src/model/floatFactory.ts`), and this listener re-triggers signature help after the
popup changes so it reappears. A brief comment explaining this intent (and why `hideOnChange` gates
it) would help future maintainers understand the flow.



─── src/handler/workspace.ts:20-20 ───
✅ resolved — `crypto` imported from '../util/node'
[maintainability · low] `crypto.randomUUID()` on line 106 relies on Node's global `crypto` (the
WebCrypto API), but this file does not import `crypto`. Everywhere else in the codebase (e.g.,
src/core/watchman.ts, src/model/status.ts, src/provider/*) consistently imports `crypto` from
'../util/node' (Node's crypto module). Although the global WebCrypto is available on the declared
engine (Node >= 20.19.0), relying on it here is inconsistent and fragile. Import `crypto` from
'../util/node' to keep the module self-contained and aligned with the rest of the project.

- import { fs, os, path, stripAnsi } from '../util/node'
+ import { crypto, fs, os, path, stripAnsi } from '../util/node'


─── src/language-client/foldingRange.ts:26-29 ───
✅ resolved — shape field renamed to `onDidChangeFoldingRanges` to match the provider event
[maintainability · low] Naming inconsistency: this field is singular `onDidChangeFoldingRange`,
while the provider event it backs is plural `onDidChangeFoldingRanges` (see
`onDidChangeFoldingRanges: eventEmitter.event` below, and the `FoldingRangeProvider` type). The same
data is referred to by two different names in the refresh flow, which is confusing for maintainers.
Consider aligning the shape field name with the plural event name (as
`InlayHintsProviderShape.onDidChangeInlayHints` does in inlayHint.ts).



─── src/language-client/foldingRange.ts:26-29 ───
✅ resolved — semicolons dropped to match surrounding style
[style · low] The new interface uses semicolon separators, which is inconsistent with the project's
semicolon-less style (e.g. `FoldingRangeProviderMiddleware` above and the sibling
`CodeLensProviderShape`/`InlayHintsProviderShape` interfaces). Suggest dropping the semicolons to
match the surrounding code.



─── src/language-client/client.ts:1220-1225 ───
✅ resolved — deferred failure handling wrapped in try/catch so a throw from
`initializationFailedHandler` can't crash the process
[bug · medium] Wrapping the failure handling in `process.nextTick` changes error containment: any
exception thrown synchronously inside this callback — most notably from the user-supplied
`this._clientOptions.initializationFailedHandler(error)` — is no longer part of the `initialize()`
rejection chain. Previously a throw from the handler propagated out of the `catch` and was handled
by `_start()`'s try/catch (setting `StartFailed` and rejecting); now it surfaces as an uncaught
exception that can crash the long-running extension host. Additionally, since `throw error` at the
end of the catch executes first, this deferred block can run after the client has already moved to a
later state (stopped/disposed) and call `this.stop()` / `window.showErrorMessage` on stale state.
Consider wrapping the callback body in a try/catch (or `Promise.resolve().then(...).catch(...)`) and
re-checking client state before acting.

        process.nextTick(() => {
+         try {
          if (this._connection !== connection) {
            logger.error(`Server "${this.id}" initialization failed on a superseded connection.`, error)
            return
          }
          this.error('Server initialization failed.', error)


─── src/language-client/client.ts:970-975 ───
✅ resolved — the superseded start promise's rejection is consumed with a no-op catch
[bug · medium] When a restart is in progress (`this._onStart !== promise`), the original `promise`
is settled via `this._onStart.then(resolve, reject)`. However, `_start()` returns `this._onStart`
(the newer attempt's promise), so once `_onStart` was reassigned the original `promise` has no
consumer. If the newer restart attempt later rejects, the original promise rejects with no handler
attached, producing an unhandled promise rejection. Consider attaching a no-op catch to the original
promise or otherwise ensuring its rejection is always consumed.

        if (this._onStart !== undefined && this._onStart !== promise) {
          // The connection closed while this attempt was starting and a newer
          // start attempt (restart) is now current. This failure is expected:
          // don't clobber the newer attempt's state or spuriously reject the
          // original start promise. Settle it with the current attempt instead.
          this._onStart.then(resolve, reject)
+         void promise.catch(() => {})


─── src/language-client/textSynchronization.ts:362-363 ───
✅ resolved — both emitters re-created on dispose like the base feature (regression test added)
[bug · medium] Disposing these emitters without re-initializing them breaks client restarts.
Built-in features are created once in the constructor and reused across restarts
(cleanUp(ShutdownMode.Restart) disposes them, then the same instances are re-used). The base
TextDocumentEventFeature.dispose() deliberately re-creates its emitters after disposing them:
`this._onAboutToSendNotification = new Emitter()` / `this._onNotificationSent = new Emitter()`. Here
both emitters stay disposed, so after a restart `onAboutToSendNotification`/`onNotificationSent`
will be no-ops, and subscribers (e.g. pull-diagnostics `onChange` via
`changeFeature.onNotificationSent`) will silently stop receiving events. Follow the base class
pattern and re-initialize both emitters.

      this._onAboutToSendNotification.dispose()
+     this._onAboutToSendNotification = new Emitter()
      this._onNotificationSent.dispose()
+     this._onNotificationSent = new Emitter()


─── src/language-client/textSynchronization.ts:145-145 ───
✅ resolved — returns `false` when `_delayOpen` is disabled
[other · low] The method now declares a `Promise<boolean>` return type, but when `_delayOpen` is
false the early `return` at `if (!this._delayOpen) return` yields `undefined` rather than a boolean.
Current callers only check truthiness so it works today, but any future caller doing a strict
comparison (`=== false`) would misbehave. Return `false` explicitly for a consistent contract.

    public async sendPendingOpenNotifications(closingDocument?: string): Promise<boolean> {
+     if (!this._delayOpen) return false


─── src/neovim/attach/attach.ts:42-42 ───
✅ resolved — writer error handler moved into the writer/reader guard; invalid args now reach the friendly error (test added)
[bug · medium] `writer` is only assigned inside the `socket`/`reader&&writer`/`proc` branches. When
`attach()` is called without any of these (all `Attach` fields are optional), `writer` remains
`undefined`, and this unguarded `writer.on(...)` call throws `TypeError: Cannot read properties of
undefined (reading 'on')`. As a result, the intended `throw new Error('Invalid arguments, could not
attach')` below is unreachable and the caller gets an obscure TypeError instead of the friendly
message. Guard the registration, e.g. wrap the error-handler inside the `if (writer && reader)`
block.



─── src/neovim/attach/attach.ts:43-43 ───
✅ resolved — strict equality
[style · low] Use strict equality `===` instead of loose `==` for comparing error codes.

-     if (err.code == 'EPIPE') {
+     if (err.code === 'EPIPE') {


─── src/neovim/api/client.ts:252-252 ───
✅ resolved — strict equality across client.ts (`responses.size`, pauseLevel, event method names)
[style · low] Loose equality is used instead of strict equality. The same issue appears in
`pauseNotification` (`this.transport.pauseLevel != 0`) and in `handleNotification` (`method ==
'vim_buf_change_event'`, `method == 'nvim_async_request_event'`, `method ==
'nvim_async_response_event'`). Use `===` / `!==` to avoid implicit type coercion.

-     if (this.responses.size == 0) return
+     if (this.responses.size === 0) return


─── src/neovim/api/client.ts:410-411 ───
✅ resolved — the notify variant now returns `void` (fire-and-forget) instead of wrapping a `null`
in a Promise; the transport promise is explicitly discarded
[bug · low] Type contract mismatch: this overload declares a return type of `null`, but the
implementation actually returns `Promise.resolve(null)` — a Promise. The underlying
`transport.resumeNotification(true)` already returns `null` (per its own overload), so wrapping it
in a Promise contradicts the declared signature and would surprise callers that rely on the `null`
type. Return the transport call directly.

-       this.transport.resumeNotification(true)
-       return Promise.resolve(null)
+       return this.transport.resumeNotification(true)


─── src/neovim/api/client.ts:274-274 ───
✅ resolved — typed as `VimValue[]` / `Promise<VimValue>`
[maintainability · low] `args`/return value are typed as `any` without an explanatory comment. Since
these values are marshalled to/from Neovim via msgpack, the more precise `VimValue[]` /
`Promise<VimValue>` types are available (already imported). If `any` is genuinely required for the
generic RPC payload, add a comment explaining why.

-   public sendAsyncRequest(method: string, args: any[]): Promise<any> {
+   public sendAsyncRequest(method: string, args: VimValue[]): Promise<VimValue> {


─── src/neovim/transport/base.ts:58-58 ───
✅ resolved — overload now declares `Promise<AtomicResult | undefined> | null` matching the implementation (test added)
[maintainability · medium] The overload `resumeNotification(isNotify: true): null` does not match
the actual implementation: when there are paused notifications (`list && list.length`), the method
returns a `Promise` that resolves to `undefined`, not `null`. Only the empty-list/`pauseLevel == 0`
paths return `null`. Callers (e.g., `NeovimClient.resumeNotification` in `client.ts`) currently
discard the return value so it happens to work, but the declared contract is misleading and could
cause bugs if a caller relies on it. Either change the overload to `Promise<void> | null`, or make
the implementation consistently return `null` for the `isNotify` case.



─── src/neovim/transport/base.ts:33-33 ───
✅ resolved — strict equality in base.ts; dead `info` method removed
[style · low] The project rules prohibit loose equality (`==`/`!=`); these comparisons should use
strict `===`/`!==`. The same applies to the other `==` usages in this file: `msgType == 1`, `msgType
== 2`, `pauseLevel == 0`, and `res[1] != null`.



─── src/neovim/transport/base.ts:26-26 ───
✅ resolved — removed dead `info` method
[maintainability · low] `info` is a protected method that is never invoked in this class or its
subclasses (`NvimTransport`, `VimTransport`), so it is dead code. Remove it (and the corresponding
module-level logger usage) or start using it.



─── src/neovim/utils/devnull.ts:5-5 ───
✅ resolved — `_write` parameters typed to match Node stream contract
[maintainability · low] The `_write` signature uses `any` for all parameters without any
explanation, which loses type safety. Node's stream types define a narrower contract: `_write(chunk:
any, encoding: BufferEncoding, callback: (error?: Error | null) => void)`. Consider typing `enc` as
`BufferEncoding` and `cb` as `(error?: Error | null) => void` (and `chunk` as `Buffer | string`) to
align with the base class and make callers' intent clearer.

- public _write(chunk: any, enc: any, cb: (...args: any[]) => any) {
+ public _write(chunk: Buffer | string, enc: BufferEncoding, cb: (error?: Error | null) => void) {


─── src/neovim/utils/constants.ts:2-2 ───
✅ resolved — strict equality in constants.ts
[style · low] Per the project's code style rules, loose equality `==` should not be used; use strict
equality `===`. `process.env.COC_NVIM` is either a string or `undefined`, so `=== '1'` is the
correct, type-safe comparison.

- export const isCocNvim = process.env.COC_NVIM == '1'
+ export const isCocNvim = process.env.COC_NVIM === '1'


─── src/neovim/utils/constants.ts:4-4 ───
✅ resolved — strict equality
[style · low] Same issue: replace loose equality `==` with strict equality `===` for the
`COC_TESTER` environment variable check.

- export const isTester = process.env.COC_TESTER == '1'
+ export const isTester = process.env.COC_TESTER === '1'


─── src/neovim/utils/constants.ts:6-6 ───
✅ resolved — strict equality
[style · low] Same issue: replace loose equality `==` with strict equality `===` for the
`VIM_NODE_RPC` environment variable check.

- export const isVim = process.env.VIM_NODE_RPC == '1'
+ export const isVim = process.env.VIM_NODE_RPC === '1'


─── src/neovim/transport/request.ts:44-44 ───
✅ resolved — list-returning cases guarded with `Array.isArray` (test added)
[bug · medium] `result` is assumed to be an array in these list-returning cases. If the Vim/Neovim
side ever returns `null`/`undefined` or a non-array value (e.g. an unexpected error object that
bypasses the `err` branch), `result.map(...)` throws a `TypeError` and breaks the whole callback
chain. Guard with `Array.isArray(result)` before mapping (applies to the `nvim_list_bufs` and
`nvim_list_tabpages` branches too).

-         return cb(null, result.map(o => client.createWindow(o)))
+         return cb(null, Array.isArray(result) ? result.map(o => client.createWindow(o)) : result)


─── src/neovim/transport/request.ts:22-22 ───
✅ resolved — `nvim_` prefix stripped only when present (test added)
[maintainability · low] `method.slice(5)` silently assumes every method name passed to `request()`
starts with `nvim_` (stripping exactly 5 characters). All current callers (BaseApi prefixes like
`nvim_buf_`, `nvim_win_`, `nvim_tabpage_`, and `nvim_get_api_info`) satisfy this today, but the
public signature `request(method: string, ...)` does not enforce it — a method without the `nvim_`
prefix (or shorter than 5 chars) would be silently truncated and dispatch to the wrong Vim function.
Consider validating with `method.startsWith('nvim_')` or documenting the prefix contract.



─── src/neovim/transport/request.ts:7-7 ───
✅ resolved — `method` initialized to `''`
[maintainability · low] `method` is declared but never initialized in the constructor. Although
`strictPropertyInitialization` is disabled in tsconfig, if `callback()` is ever invoked before any
of `request()`/`call()`/`expr()` has set `method` (e.g. a response dispatched synchronously right
after the transport registers the pending id), the switch will silently fall through to `default`
and skip the Window/Buffer/Tabpage object conversion. Initialize `method` (e.g. `private method =
''`) or guard against `undefined` in `callback()`.

-   private method: string
+   private method = ''


─── src/util/index.ts:9-9 ───
✅ resolved — strict equality
[style · low] Use strict equality `===` here instead of loose equality `==`. Since
`process.env.COC_TESTER` is `undefined` when unset, `===` behaves identically to `==` in this case,
but loose equality is prohibited by the coding standard.

- export const isTester = process.env.COC_TESTER == '1'
+ export const isTester = process.env.COC_TESTER === '1'
