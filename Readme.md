# [C](#)onqure [o](#)f [C](#)ompletion

| CI (Linux, macOS)                       | Coverage                               | Gitter                      | Doc                        |
| --------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- |
| [![Build Status Badge][]][build status] | [![Coverage Badge][]][coverage report] | [![Gitter Badge][]][gitter] | [![Doc Badge][]][doc link] |

Coc is an intellisense engine for vim8 & neovim.

It's a completion framework, language server client which
[support extension features of VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

![example.gif](https://user-images.githubusercontent.com/251450/42722527-028898ea-8780-11e8-959f-09db0d39ba05.gif)

_True snippet and additional text edit support_

Checkout [doc/coc.txt](doc/coc.txt) for vim interface.

## Why?

- 🚀 **Fast**: instant increment completion, increment buffer sync using buffer update events.
- 💎 **Reliable**: typed language, tested with CI.
- 🌟 **Featured**: [full LSP support](https://github.com/neoclide/coc.nvim/wiki/Language-servers#supported-features)
- ❤️ **Flexible**: [configured as VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file), [extensions works like VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

## Table of contents

- [Installation](https://github.com/neoclide/coc.nvim/wiki/Install-coc.nvim)

  For [vim-plug](https://github.com/junegunn/vim-plug) user. Add:

  ```vim
  Plug 'neoclide/coc.nvim', {'tag': '*', 'do': { -> coc#util#install()}}
  ```

  Or build from source code by install [nodejs](https://nodejs.org/en/download/)
  and [yarn](https://yarnpkg.com/en/docs/install)

  ```sh
  curl -sL install-node.now.sh/lts | sh
  curl --compressed -o- -L https://yarnpkg.com/install.sh | bash
  ```

  And add:

  ```vim
  Plug 'neoclide/coc.nvim', {'do': 'yarn install'}
  ```

  to your `.vimrc` or `init.vim`, restart vim and run `:PlugInstall`.

  For other plugin manager, run command `:call coc#util#install()` to download
  binary after coc is installed.

  **Note:** neovim >= 0.3.0 or vim >= 8.1 is required.

  **Note:** for vim user, global installed [vim-node-rpc](https://github.com/neoclide/vim-node-rpc) module required.

- [Completion with sources](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources)

  - [Trigger mode of completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#trigger-mode-of-completion)
  - [Use `<Tab>` or custom key for trigger completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#use-tab-or-custom-key-for-trigger-completion)
  - [Improve completion experience](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#improve-completion-experience)
  - [Completion sources](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#completion-sources)

- [Using snippets](https://github.com/neoclide/coc.nvim/wiki/Using-snippets)

- [Using extensions](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

  - [Manage extensions](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions#installupdate-coc-extension)

- [Using configuration file](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file)

  - [Configuration file resolve](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#configuration-file-resolve)
  - [Default COC preferences](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#default-coc-preferences)
  - [Configuration for sources](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#configuration-for-sources)
  - [Extension configuration](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#extension-configuration)

- [Language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers)

  - [Supported features](https://github.com/neoclide/coc.nvim/wiki/Language-servers#supported-features)
  - [Register custom language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers)

    - [Dart](https://github.com/neoclide/coc.nvim/wiki/Language-servers#darto)
    - [C/C++/Objective-C](https://github.com/neoclide/coc.nvim/wiki/Language-servers#ccobjective-c)
    - [Go](https://github.com/neoclide/coc.nvim/wiki/Language-servers#go)
    - [PHP](https://github.com/neoclide/coc.nvim/wiki/Language-servers#php)

- [Statusline integration](https://github.com/neoclide/coc.nvim/wiki/Statusline-integration)

- [Debug language server](https://github.com/neoclide/coc.nvim/wiki/Debug-language-server)

- [F.A.Q](https://github.com/neoclide/coc.nvim/wiki/F.A.Q)

## Completion sources

Completion for words of buffers and file path are supported by default.

For other completion sources, check out:

- [coc-sources](https://github.com/neoclide/coc-sources): includes some common
  completion source extensions.
- [coc-neco](https://github.com/neoclide/coc-neco): viml completion support.

Or you can [create custom source](https://github.com/neoclide/coc.nvim/wiki/Create-custom-source).

## Extensions

Extension are powerful than configured language server. Checkout
[Using coc extensions](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions).

- **[coc-json](https://github.com/neoclide/coc-json)** for `json`.
- **[coc-tsserver](https://github.com/neoclide/coc-tsserver)** for `javascript`
  and `typescript`.
- **[coc-html](https://github.com/neoclide/coc-html)** for `html`, `handlebars`
  and `razor`.
- **[coc-css](https://github.com/neoclide/coc-css)** for `css`, `scss` and `less`.
- **[coc-vetur](https://github.com/neoclide/coc-vetur)** for `vue`, use [vetur](https://github.com/vuejs/vetur).
- **[coc-java](https://github.com/neoclide/coc-java)** for `java`, use [eclipse.jdt.ls](https://github.com/eclipse/eclipse.jdt.ls).
- **[coc-solargraph](https://github.com/neoclide/coc-solargraph)** for `ruby`,
  use [solargraph](http://solargraph.org/).
- **[coc-rls](https://github.com/neoclide/coc-rls)** for `rust`, use
  [Rust Language Server](https://github.com/rust-lang/rls)

And more, to get full list of coc extensions, [search coc.nvim on npm](https://www.npmjs.com/search?q=keywords%3Acoc.nvim).

**Note:** use `:CocConfig` to edit configuration file, auto completion is
supported after `coc-json` installed.

## Example vim configuration

```vim
" if hidden not set, TextEdit might fail.
set hidden

" Better display for messages
set cmdheight=2

" Smaller updatetime for CursorHold & CursorHoldI
set updatetime=300

" always show signcolumns
set signcolumn=yes

" Use tab for trigger completion with characters ahead and navigate.
" Use command ':verbose imap <tab>' to make sure tab is not mapped by other plugin.
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Use <c-space> for trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" Use <cr> for confirm completion.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"

" Use `[c` and `]c` for navigate diagnostics
nmap <silent> [c <Plug>(coc-diagnostic-prev)
nmap <silent> ]c <Plug>(coc-diagnostic-next)

" Remap keys for gotos
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)

" Use K for show documentation in preview window
nnoremap <silent> K :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if &filetype == 'vim'
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

" Show signature help while editing
autocmd CursorHoldI * silent! call CocActionAsync('showSignatureHelp')

" Highlight symbol under cursor on CursorHold
autocmd CursorHold * silent call CocActionAsync('highlight')

" Remap for rename current word
nmap <leader>rn <Plug>(coc-rename)

" Remap for format selected region
vmap <leader>f  <Plug>(coc-format-selected)
nmap <leader>f  <Plug>(coc-format-selected)

" Remap for do codeAction of selected region, ex: `<leader>aap` for current paragraph
vmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap for do codeAction of current line
nmap <leader>ac  <Plug>(coc-codeaction)

" Use `:Format` for format current buffer
command! -nargs=0 Format :call CocAction('format')

" Use `:Fold` for fold current buffer
command! -nargs=? Fold :call     CocAction('fold', <f-args>)


" Add diagnostic info for https://github.com/itchyny/lightline.vim
let g:lightline = {
      \ 'colorscheme': 'wombat',
      \ 'active': {
      \   'left': [ [ 'mode', 'paste' ],
      \             [ 'cocstatus', 'readonly', 'filename', 'modified' ] ]
      \ },
      \ 'component_function': {
      \   'cocstatus': 'coc#status'
      \ },
      \ }



" Shortcuts for denite interface
" Show symbols of current buffer
nnoremap <silent> <space>o  :<C-u>Denite coc-symbols<cr>
" Search symbols of current workspace
nnoremap <silent> <space>t  :<C-u>Denite coc-workspace<cr>
" Show diagnostics of current workspace
nnoremap <silent> <space>a  :<C-u>Denite coc-diagnostic<cr>
" Show available commands
nnoremap <silent> <space>c  :<C-u>Denite coc-command<cr>
" Show available services
nnoremap <silent> <space>s  :<C-u>Denite coc-service<cr>
" Show links of current buffer
nnoremap <silent> <space>l  :<C-u>Denite coc-link<cr>
```

## Feedback

If you like this plugin, star it! It's a great way of getting feedback. The same goes for reporting issues or feature requests.

Contact: [Gitter](https://gitter.im/coc-nvim/Lobby) [Twitter](https://twitter.com/chemzqm)

## LICENSE

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_large)

[build status badge]: https://api.travis-ci.org/neoclide/coc.nvim.svg?branch=master
[build status]: https://travis-ci.org/neoclide/coc.nvim
[coverage badge]: https://codecov.io/gh/neoclide/coc.nvim/branch/master/graph/badge.svg
[coverage report]: https://codecov.io/gh/neoclide/coc.nvim
[gitter badge]: https://badges.gitter.im/neoclide/coc.nvim.svg
[gitter]: https://gitter.im/neoclide/coc.nvim
[doc badge]: https://img.shields.io/badge/doc-%3Ah%20coc.txt-red.svg
[doc link]: doc/coc.txt
