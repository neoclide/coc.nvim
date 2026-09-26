# Bundled native watcher binaries

These eight `.node` files are prebuilt [`native-watcher`](https://github.com/neoclide/native-watcher)
addons. coc.nvim loads them directly; `native-watcher` is not an npm dependency.
On Linux with glibc below 2.28, coc.nvim skips the native watcher and uses the
existing Watchman fallback when available.

To update them, download or build all CI artifacts in a local native-watcher
checkout, then run:

```sh
npm run update:watcher-binaries -- /path/to/native-watcher/build/artifacts
```

The source directory must contain the eight target-named `.node` files. Verify
the packaged files and the upstream MIT license with:

```sh
npm run check:watcher-binaries
```

The raw addon ABI is `subscribe(root, callback, options)` and
`unsubscribe(root, callback, options)`. `callback` receives an error or a batch
of `{ type, kind, path, renameId? }` events. `renameId` pairs a correlated
delete and create event.
