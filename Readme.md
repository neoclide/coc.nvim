# Complete.nvim

Make complete works as expected in [neovim](https://github.com/neovim/neovim)

W.I.P.

## Features

* Async generate complete items in parallel.
* Fuzzy match with score by default.
* Minimal configuration required to work.
* Always respect vim options like `completeopt`.
* Support `text_edit` and `snippet` described in LSP 2.0.

## Install

Take [dein.vim](https://github.com/Shougo/dein.vim) as example:

``` vim
 call dein#add('neoclide/complete.nvim', {
    \ 'build': 'make'
    \})
```

**Note:** [nodejs](http://nodejs.org/) version > 9.0 is required.

**Note:** Don't use lazyload feature of plugin manager for this plugin.

## Set trigger for completion

```
imap <c-space> <Plug>(complete_start)
```

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

* `g:complete_fuzzy_match` set to `0` if you want to disable fuzzy match.
* `g:complete_timeout` timeout in milisecond for completion, default `300`
* `g:complete_no_trace` set to `1` to disable send message on error
* `g:complete_check_git_ignore` set to `1` to not include the buffer when it's a
  git ignored file.
* `g:complete_popup_on_dot` set to `1` if you want the popup shown on dot
  on type.

## Similar projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [asyncomplete.vim](https://github.com/prabirshrestha/asyncomplete.vim)
* [vim-mucomplete](https://github.com/lifepillar/vim-mucomplete/)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)

## LICENSE

MIT
