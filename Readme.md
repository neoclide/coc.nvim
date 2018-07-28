# [C](#)onqure [o](#)f  [C](#)ompletion

[![Join the chat at https://gitter.im/coc-nvim/Lobby](https://badges.gitter.im/coc-nvim/Lobby.svg)](https://gitter.im/coc-nvim/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_shield)
[![](https://img.shields.io/badge/doc-%3Ah%20coc.txt-red.svg)](doc/coc.txt)

Coc is an intellisense engine for vim & neovim.

It's a completion framework, language server client while comes with bundled
extensions from [VSCode](https://github.com/Microsoft/vscode) that just works.

![example.gif](https://user-images.githubusercontent.com/251450/42722527-028898ea-8780-11e8-959f-09db0d39ba05.gif)

_True snippet and additional text edit support_

Checkout [doc/coc.txt](doc/coc.txt) for vim interface.

## Pros.

* Easy to install and many features just work.
* Super fast initialization and completion.
* Full completion feature support of LSP.
* Featured language server extensions from VSCode, like tsserver, tslint etc.
* Custom language server configuration support.

## Language support

* **Typescript** and **Javascript**

  Extension [tsserver](src/extensions/tsserver).

* **HTML**

  Extension [html](src/extensions/html).

* **JSON**

  Extension [json](src/extensions/json).

* **Css**, **less**, **scss** and **wxss**

  Extension [css](src/extensions/css)

* **Wxml**

  Extension [wxml](src/extensions/wxml)

* **Vue**

  Extension [vetur](src/extensions/vetur)

* **Ruby**

    Install [solargraph](http://solargraph.org/) by:

        gem install solargraph

    The configuration field is `solargraph`.

* **Python**

    Install [pyls](https://github.com/palantir/python-language-server) by:

        pip install 'python-language-server[all]'

    The configuration field is `pyls`.

**Note:** auto completion is supported automatically for `coc-settings.json`

## Table of contents

* [Installation](https://github.com/neoclide/coc.nvim/wiki/Install-coc.nvim)

  Install [nodejs](https://nodejs.org/en/download/) and [yarn](https://yarnpkg.com/en/docs/install)

  For [vim-plug](https://github.com/junegunn/vim-plug) user. Add:

  ``` vim
  Plug 'neoclide/coc.nvim', {'do': 'yarn install'}
  ```

  to your `.vimrc`, restart neovim and run `:PlugInstall`.

* [Completion with sources](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources)

  * [Trigger mode of completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#trigger-mode-of-completion)
  * [Snippet completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#snippet-completion)
  * [Use `<Tab>` or custom key for trigger completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#use-tab-or-custom-key-for-trigger-completion)
  * [Improve completion experience](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#improve-completion-experience)
  * [Completion sources](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#completion-sources)

* [Using configuration file](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file)

  * [Configuration file resolve](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#configuration-file-resolve)
  * [Default COC preferences](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#default-coc-preferences)
  * [Configuration for sources](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#configuration-for-sources)
  * [Extension configuration](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file#extension-configuration)

* [Language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers)

  * [Supported features](https://github.com/neoclide/coc.nvim/wiki/Language-servers#supported-features)
  * [Built in server extensions](https://github.com/neoclide/coc.nvim/wiki/Language-servers#built-in-server-extensions)
  * [Register custom language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers)
  * [Debug language server](https://github.com/neoclide/coc.nvim/wiki/Debug-language-server)

* [ Statusline integration](https://github.com/neoclide/coc.nvim/wiki/Statusline-integration)

* [Create custom source](https://github.com/neoclide/coc.nvim/wiki/Create-custom-source)

* [F.A.Q](https://github.com/neoclide/coc.nvim/wiki/F.A.Q)

## Example configuration

``` vim
" Use tab for trigger completion with characters ahead.
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
autocmd CursorHoldI,CursorMovedI * silent! call CocAction('showSignatureHelp')

" Open quickfix list on quickfix change triggered by coc
autocmd User CocQuickfixChange :copen

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

" Use `:Format` for format current file
command! -nargs=0 Format :call CocAction('format')

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
```

## Trouble shooting

When you find the plugin is not working as you would expected, run command
`:checkhealth` and make sure that output from `coc.nvim` are `OK`.

To get the log file, run shell command:

    node -e 'console.log(path.join(os.tmpdir(), "coc-nvim.log"))'

You can also use environment variable to change logger behaviour:

* `$NVIM_COC_LOG_LEVEL` set to `debug` for debug messages.
* `$NVIM_COC_LOG_FILE` set the file path of log file.

## LICENSE

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fneoclide%2Fcoc.nvim?ref=badge_large)
