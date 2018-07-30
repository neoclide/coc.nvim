# 2018-07-31

* Improve file source triggered with dirname started path.

# 2018-07-30

* Fix source ultisnip not working.
* Fix custom language client with command not working.
* Fix wrong arguments passed to `runCommand` function.
* Improve module install, add `sudo` for `npm install` on Linux.
* Improve completion on backspace.
    * Completion is resumed when search is empty.
    * Completion is triggered when user try to fix search.

# 2018-07-29

* **Break change** all servers are decoupled from coc.nvim

  A prompt for download is shown when server not found.

* **Break change** `vim-node-rpc` decoupled from coc.nvim

  A prompt would be shown to help user install vim-node-rpc in vim.

* Add command `CocConfig`

# 2018-07-28

* Fix uncaught exception error on windows.
* Use plugin root for assets resolve.
* Fix emoji source not triggered by `:`.
* Improve file source to recognize `~` as user home.

# 2018-07-27

* Prompt user for download server module with big extension like `vetur` and `wxml-langserver`
* **Break change**, section of settings changed: `cssserver.[languageId]` moved to `[languageId]`
  
  For example: `cssserver.css` section is moved to `css` section.

  This makes coc settings of css languages the same as VSCode.

* **Break change**, `stylelint` extension is disabled by default, add

  ```
  "stylelint.enable": true,
  ```

  to your `coc-settings.json` to enable it.

  User will be prompted to download server if `stylelint-langserver` is not
  installed globally.

* **Break change**, `triggerAfterInsertEnter` is always `true`, add

  ```
  "coc.preferences.triggerAfterInsertEnter": false,
  ```

  to your `coc-settings.json` to disable it.

* **Break change**, when `autoTrigger` is `always` completion would be triggered
after completion item select.

# 2018-07-24

* better statusline integration with airline and lightline.

# 2018-07-23

* Coc service start much faster.
* Add vim-node-rpc module.
* **Break change** global function `CocAutocmd` and `CocResult` are removed.
* Support Vue with vetur

# 2018-07-21

* Fix issue with `completeopt`.
* Add source `neosnippet`.
* Add source `gocode`.

# 2018-07-20

* Add documentation for language server debug.
* Rework register of functions, avoid undefined function.

# 2018-07-19

* Fix error of `isFile` check.
* Ignore undefined function on service start.

# 2018-07-17

* Add `coc.preference.jumpCommand` to settings.
* Make coc service standalone.

# 2018-07-16

* Support arguments for `runCommand` action.
* Add coc command `workspace.showOutput`.
* Support output channel for language server.
* Support `[extension].trace.server` setting for trace server communication.

# 2018-07-15

* Support location list for diagnoctic.
* Add tsserver project errors command.

# 2018-07-14

* Add support for `preselect` of complete item.
* Add support for socket language server configuration.
* Fix configured language server doesn't work.
* Add `workspace.diffDocument` coc command.
* Fix buffer sometimes not attached.
* Improve completion of JSON extension.

# 2018-07-13

* **Break change:** `diagnoctic` in setting.json changed to `diagnostic`.
* Fix clearHighlight arguments.
* Add eslint extension https://github.com/Microsoft/vscode-eslint.
* Fix snippet break with line have $variable.
* Use jsonc-parser replace json5.
* Add `data/schema.json` for coc-settings.json.

# 2018-07-12

* Fix restart of tsserver not working.
* Fix edit of current buffer change jumplist by using `:keepjumps`.

