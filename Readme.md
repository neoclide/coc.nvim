# Complete.nvim

Improved complete experience for [neovim](https://github.com/neovim/neovim)

Design principle:

* Popup should shown as less as possible
* User input required shoud as less as possible

**WARNING** main features still not working!

## Features

* Async generate complete items in parallel.
* Smart case fuzzy match with score by default.
* Minimal configuration required to work.
* Works great with `set completeopt=menu,preview`
* Support `text_edit` and `snippet` described in LSP 2.0.
* Custom sources using vim script.

## Install

Take [dein.vim](https://github.com/Shougo/dein.vim) as example:

``` vim
 call dein#add('neoclide/complete.nvim', {
    \ 'build': 'make'
    \})
```

[nodejs](http://nodejs.org/) version > 8.0 && neovim version > 0.2.2 is required.

See [trouble shooting](#trouble-shooting) if you have runtime issue.

### Set trigger for completion

``` vim
imap <c-space> <Plug>(complete_start)
```

**Use tab**

``` vim
function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~ '\s'
endfunction

inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ complete#refresh()
```

## Sources

Navtie sources are impletemented in javascript and are enabled by default.


Name         | Description                                           | Use cache   | Supported filetypes
------------ | -------------                                         | ------------|------------
`around`     | Words of current buffer                               | ✗           | all
`buffer`     | Keywords of none current buffer                       | ✓           | all
`dictionary` | Words from files of `dictionary` option               | ✓           | all
`file`       | Filename completion                                   | ✗           | all
`omni`       | Words from `omnifunc` of current buffer               | ✗           | User defined
`module`     | Words of module names                                 | ✗           | [Limited](/src/source/module_resolve)
`include`    | Full path completion for include other files          | ✗           | [Limited](/src/source/include_resolve)

Note: `module` & `path` source only have support for quite limited filetypes, need help.

Note: `filetypes` option of `omni` is empty by default, you have to set `g:complete_omni_filetypes` to make it work.

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

" Recommanded completeopt setting see `:h completeopt`
set completeopt=menu,preview
```
</details>


### Global variables

Name                           | Description                                             | Default
------------                   | -------------                                           | ------------
`g:complete_fuzzy_match`       | Use fuzzy match for words                               | 1
`g:complete_timeout`           | Timeout in milisecond for completion                    | 300
`g:complete_trace_error`       | Trace issue and send back to fundebug                   | 0
`g:complete_ignore_git_ignore` | Ignore buffers (buffer souce only) that are git ignored | 0
`g:complete_source_disabled`   | Names of disabled sources                               | []
`g:complete_omni_filetypes `   | List of filetypes for using omni source                 | []

### Commands

Commands are used change the service status on the fly.

Name                        | Description
------------                | -------------
`:CompleteRefresh [name]`   | Refresh `name` source, or all sources without argument.
`:CompleteToggle name`      | Toggle `name` source state (enable/disable).
`:CompleteDisable`          | Disable complete.nvim
`:CompleteEnable`           | Enable complete.nvim
`:Denite completes`         | Open `completes` source in [denite.nvim](https://github.com/Shougo/denite.nvim) buffer.

## Trouble shooting

When you find the plugin is not workig as you would expected, run command
`:checkhealth` and make use that output from `complete.nvim` are `OK`.

To get the log file, run shell command:

    node -e 'console.log(path.join(os.tmpdir(), "nvim-complete.log"))'

You can also use environment variable to change logger behaviour:

* `$NVIM_COMPLETE_LOG_LEVEL` set to `debug` for debug messages.
* `$NVIM_COMPLETE_LOG_FILE` set the file path of log file.

Note: Complete.nvim would disable itself when there is vim error during autocmd.

## Similar projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [asyncomplete.vim](https://github.com/prabirshrestha/asyncomplete.vim)
* [vim-mucomplete](https://github.com/lifepillar/vim-mucomplete/)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)
* [completor.vim](https://github.com/maralla/completor.vim)

## LICENSE

MIT
