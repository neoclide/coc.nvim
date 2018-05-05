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

* `g:complete_auto_popup` set to `1` if you want the popup automatically shown
  on type.
* `g:complete_lcn_file_types` array of file types to trigger completion request
  from [LanguageClient-neovim](https://github.com/autozimu/LanguageClient-neovim)

  Note: you should install and configure LanguageClient-neovim correctlly to
  make it works.

* `g:complete_sources` array of source names default to `['buffer', 'dictionary', 'path']`
* `g:complete_fuzzy_match` set to `0` if you want to disable fuzzy match.
* `g:complete_keywords_regex` javascript regex for identify words of buffer
  source, default to `[\w-_$]+`
* `g:complete_timeout` timeout in milisecond for completion, default `300`
* `g:complete_no_trace` set to `1` to disable send message on error or slow
  completion

## Related projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)

## Commands

* `CompleteCacheClean` clean the complete items cache, useful for test

## LICENSE

MIT
