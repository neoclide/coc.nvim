# [C](#)onqure [o](#)f  [C](#)ompletion

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_shield)

COC is a **fast**, **reliable** and **flexible** completion framework of
[neovim](https://github.com/neovim/neovim).

It also tries hard to have better support for web development and completion
specifications in [language server protocol](https://github.com/Microsoft/language-server-protocol)

Refer to [wiki page](https://github.com/neoclide/coc.nvim/wiki) for detail
documentation.

## Features

* Async generate complete items
* Fuzzy match with smart case.
* Full featured completion support defined in LSP.
* Built in language server extensions, like tsserver, tslint etc.
* Custom language server configuration support.

## Install

[nodejs](http://nodejs.org/) version > 8.0 && neovim version > 0.3.0 is required.

After install nodejs, install `node-client` for neovim by

``` bash
npm install -g neovim
```

Take [dein.vim](https://github.com/Shougo/dein.vim) as example:

``` vim
 call dein#add('neoclide/coc.nvim', {
    \ 'build': 'npm install'
    \})
```

Run `:checkhealth` in your neovim to make sure the check of coc success.

See [Trouble Shooting](#trouble-shooting) if you have runtime issue.

## Sources

### Common sources


Name         | Description                                             | Use cache   | Default filetypes
------------ | -------------                                           | ------------|------------
`around`     | Words of current buffer.                                | ✗           | all
`buffer`     | Words of none current buffer.                           | ✓           | all
`dictionary` | Words from files of local `dictionary` option.          | ✓           | all
`tag`        | Words from `taglist` of current buffer.                 | ✓           | all
`file`       | Filename completion, auto detected.                     | ✗           | all
`omni`       | Invoke `omnifunc` of current buffer for complete items. | ✗           | []
`word`       | Words from google 10000 english repo.                   | ✓           | all
`emoji`      | Eomji characters.                                       | ✓           | ['markdown']
`include`    | Full path completion for include file paths.            | ✗           | [Limited](/src/source/include_resolve)

`omni` source could be slow, it requires configuration for `filetypes` to work.

### Vim sources

Vim sources are implemented in viml, and usually requires other vim plugin to
work.

Name           |Description                |Filetype     | Requirement
------------   |------------               |------------ | -------------
ultisnips      |Snippets name completion   |User defined | Install [ultisnips](https://github.com/SirVer/ultisnips)
neco           |VimL completion            |vim          | Install [neco-vim](https://github.com/Shougo/neco-vim)

## Trouble shooting

When you find the plugin is not working as you would expected, run command
`:checkhealth` and make use that output from `coc.nvim` are `OK`.

To get the log file, run shell command:

    node -e 'console.log(path.join(os.tmpdir(), "coc-nvim.log"))'

You can also use environment variable to change logger behaviour:

* `$NVIM_COC_LOG_LEVEL` set to `debug` for debug messages.
* `$NVIM_COC_LOG_FILE` set the file path of log file.

Note: Coc would disable itself when there is vim error during autocmd.

## LICENSE

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_large)
