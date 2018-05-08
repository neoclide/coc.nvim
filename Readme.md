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

* `g:complete_fuzzy_match` set to `0` if you want to disable fuzzy match.
* `g:complete_timeout` timeout in milisecond for completion, default `300`
* `g:complete_no_trace` set to `1` to disable send messages on error

* `g:complete_check_git_ignore` set to `1` to not include the buffer when it's a
  git ignored file.
* `g:complete_popup_on_dot` set to `1` if you want the popup shown on dot
  on type.

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

* **complete#disable()**

  Disable complete.nvim from listening autocmd.

* **:Denite completes**

  Open `completes` source in [denite.nvim](https://github.com/Shougo/denite.nvim)

## Similar projects

* [deoplete.nvim](https://github.com/Shougo/deoplete.nvim)
* [asyncomplete.vim](https://github.com/prabirshrestha/asyncomplete.vim)
* [vim-mucomplete](https://github.com/lifepillar/vim-mucomplete/)
* [nvim-completion-manager](https://github.com/roxma/nvim-completion-manager)

## LICENSE

MIT
