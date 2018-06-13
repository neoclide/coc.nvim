# [C](#)onqure [o](#)f  [C](#)ompletion

COC is a **fast**, **reliable** and **flexible** completion framework of
[neovim](https://github.com/neovim/neovim).

It also tries hard to have better support for web development and completion
specifications in [language server protocol](https://github.com/Microsoft/language-server-protocol)

W.I.P.🐒

## Features

* Async generate complete items in parallel.
* Smart case with fuzzy match.
* Scoped configuration file.
* Full featured completion support defined in LSP.
* Custom sources using vim script.

## Install

Take [dein.vim](https://github.com/Shougo/dein.vim) as example:

``` vim
 call dein#add('neoclide/coc.nvim', {
    \ 'build': 'npm install'
    \})
```

[nodejs](http://nodejs.org/) version > 8.0 && neovim version > 0.3.0 is required.

See [trouble Shooting](#trouble-shooting) if you have runtime issue.

### Set trigger for completion

**Tab is awesome**

``` vim
function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~ '\s'
endfunction

inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
```

**Use custom key**

``` vim
imap <c-space> coc#refresh()
```

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
`module`     | Words of module names.                                  | ✗           | [Limited](/src/source/module_resolve)
`include`    | Full path completion for include file paths.            | ✗           | [Limited](/src/source/include_resolve)

`omni` source could be slow, it requires configuration for `filetypes` to work.

### Vim sources

Vim sources are implemented in viml, and usually requires other vim plugin to
work.

Name           |Description                |Filetype     | Requirement
------------   |------------               |------------ | -------------
ultisnips      |Snippets name completion   |User defined | Install [ultisnips](https://github.com/SirVer/ultisnips)
languageclient |Completion from LSP service|User defined | Install [LanguageClient-neovim](https://github.com/autozimu/LanguageClient-neovim)
neco           |VimL completion            |vim          | Install [neco-vim](https://github.com/Shougo/neco-vim)

### Language sources

COC have service support for some languages, compare to the using of `omnifunc`,
they run in async and could have extra functionalities.

<details>
  <summary><strong>tern</strong> for Javascript</summary>

  Using <a href="https://github.com/ternjs/tern">tern</a> as engine, no extra installation
  required.

  Addtional support: `show documents`, `jump to definition` and `show signature`.

  Use `:h coc_source_tern` in vim for detail.
</details>

## Configuration

<details>
  <summary>Here're some common complete configuration of vim:</summary>

``` vim
" user <Tab> and <S-Tab> to iterate complete item
inoremap <expr> <Tab> pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
" use <enter> to finish complete
inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<cr>"

" Auto close preview window when completion is done.
autocmd! CompleteDone * if pumvisible() == 0 | pclose | endif

" The completeopt coc works best with, see `:h completeopt`
set completeopt=menu,preview
```
</details>

COC make use of configuration file in JSON5 format, check out [Configuration-file-of-COC.nvim](https://github.com/neoclide/coc.nvim/wiki/Configuration-file-of-COC.nvim)

### Commands

Commands are used change the service status on the fly.

Name                 | Description
------------         | -------------
`:CocRefresh [name]` | Refresh `name` source, or all sources without argument.
`:Denite coc`        | Check source list of current buffer in [denite.nvim](https://github.com/Shougo/denite.nvim) buffer.

## Trouble shooting

When you find the plugin is not working as you would expected, run command
`:checkhealth` and make use that output from `coc.nvim` are `OK`.

To get the log file, run shell command:

    node -e 'console.log(path.join(os.tmpdir(), "coc-nvim.log"))'

You can also use environment variable to change logger behaviour:

* `$NVIM_COC_LOG_LEVEL` set to `debug` for debug messages.
* `$NVIM_COC_LOG_FILE` set the file path of log file.

Note: Coc would disable itself when there is vim error during autocmd.

## Similar projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [asyncomplete.vim](https://github.com/prabirshrestha/asyncomplete.vim)
* [vim-mucomplete](https://github.com/lifepillar/vim-mucomplete/)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)
* [completor.vim](https://github.com/maralla/completor.vim)

## LICENSE

This work is released under [The MIT License](https://opensource.org/licenses/MIT)

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_large)
