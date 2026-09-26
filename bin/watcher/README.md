# Bundled native watcher binaries

These eight `.node` files are prebuilt [`native-watcher`](https://github.com/neoclide/native-watcher)
addons. coc.nvim loads them directly; `native-watcher` is not an npm dependency.
On Linux with glibc below 2.28, coc.nvim skips the native watcher and uses the
existing Watchman fallback when available.

To update them, install the GitHub CLI (`gh`), authenticate with `gh auth login`,
then run:

```sh
npm run update:watcher-binaries
```

The script selects the latest successful `test.yml` workflow run on the
`main` branch of `neoclide/native-watcher` and downloads its eight
`native-watcher-*` artifacts using that run ID. It checks all eight binaries
before copying them into this directory and removes the temporary downloads.
Verify the packaged files and the upstream MIT license with:

```sh
npm run check:watcher-binaries
```

The raw addon ABI is `subscribe(root, callback, options)` and
`unsubscribe(root, callback, options)`. `callback` receives an error or a batch
of `{ type, kind, path, renameId? }` events. `renameId` pairs a correlated
delete and create event.
