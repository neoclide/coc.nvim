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

Run **`:checkhealth`** when you get any trouble.


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


### Global configuration of complete.nvim:

Name                           | Description                                             | Default
------------                   | -------------                                           | ------------
`g:complete_fuzzy_match`       | Use fuzzy match for words                               | 1
`g:complete_timeout`           | Timeout in milisecond for completion                    | 300
`g:complete_trace_error`       | Trace issue and send back to fundebug                   | 0
`g:complete_ignore_git_ignore` | Ignore buffers (buffer souce only) that are git ignored | 0
`g:complete_source_disabled`   | Names of disabled sources                               | []

### Functions & commands of complete.nvim

Functions could change complete.nvim behavour on the fly, since complete.nvim
initailzed in async, you could only use them after autocmd `CompleteNvimInit`
triggered, like:

``` vim
function s:ConfigComplete()
  call complete#source#config('dictionary', {
      \ 'disabled': 1
      \})
endfunction
autocmd user CompleteNvimInit call s:ConfigComplete()
```

* **complete#source#config(name, options)**

  Set configuration for `name` source, `options` could contains fields like
  `filetypes`, `disabled`

* **complete#source#refresh([name])**

  Refresh `name` source, or all sources without argument.

* **complete#source#toggle(name)**

  Toggale `name` source state (enable/disable)

* **complete#disable()**

  Disable complete.nvim from listening autocmd.

* **:Denite completes**

  Open `completes` source in [denite.nvim](https://github.com/Shougo/denite.nvim) buffer.

## Similar projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [asyncomplete.vim](https://github.com/prabirshrestha/asyncomplete.vim)
* [vim-mucomplete](https://github.com/lifepillar/vim-mucomplete/)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)

## LICENSE

MIT
