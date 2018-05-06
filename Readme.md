# Complete.nvim

Make complete works as expected in [neovim](https://github.com/neovim/neovim)

## Features

* Async generate complete items in parallel.
* Fuzzy match with score for none LSP complete items.
* Minimal configuration required to work.
* Always respect vim options like `completeopt`.
* Support `text_edit` and `snippet` described in LSP 2.0.

## Install

Take [vim-plug](https://github.com/junegunn/vim-plug) as example:

``` vim
Plug 'neoclide/complete.nvim', {
    \ 'do': 'make',
    \ }
```

Note: [nodejs](http://nodejs.org/) version > 9.0 is required.

## Set trigger for completion

```
imap <c-space> <Plug>(complete_start)
```

This could be omitted when you have `let g:complete_auto_popup = 1`

## Configuration

Here's some common complete configuration of vim:

``` vim
" user <Tab> and <S-Tab> to iterate complete item
inoremap <expr> <Tab> pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
" use <enter> to finish complete
inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<cr>"<Paste>

" Auto close preview window when completion is done.
autocmd! CompleteDone * if pumvisible() == 0 | pclose | endif

" Recommanded completeopt setting see `:h completeopt`
set completeopt=menu,preview
```

*Note:* you can have different `completeopt` for different buffer
by using `setl completeopt`

Configuration of complete.nvim:

* `g:complete_popup_on_dot` set to `1` if you want the popup shown on dot
  on type.
* `g:complete_sources` array of source names default to `['buffer', 'dictionary', 'path']`
* `g:complete_fuzzy_match` set to `0` if you want to disable fuzzy match.
  source, default to `[\w-_$]`
* `g:complete_timeout` timeout in milisecond for completion, default `300`
* `g:complete_no_trace` set to `1` to disable send message on error or slow
  completion

* `g:complete_menu_one` when using increment filter, `menuone,no_insert` has to
  be used in `completeopt`, but it's annoying to press a key to finish when
  there's only one complete item, this setting helps your to complete
  automatcaly.

* `g:complete_git_check_ignore` not include the buffer when it's git ignored.

## Related projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)

## Commands

* `CompleteCacheClean` clean the complete items cache, useful for test

## LICENSE

MIT
