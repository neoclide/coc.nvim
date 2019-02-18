# [C](#)onquer [o](#)f [C](#)ompletion

| CI (Linux, macOS)                       | Coverage                               | Gitter                      | Doc                        |
| --------------------------------------- | -------------------------------------- | --------------------------- | -------------------------- |
| [![Build Status Badge][]][build status] | [![Coverage Badge][]][coverage report] | [![Gitter Badge][]][gitter] | [![Doc Badge][]][doc link] |

Coc is an intellisense engine for vim8 & neovim.

It works on `vim >= 8.1` and `neovim >= 0.3.1`.

It's a completion framework, language server client which support
[extension features of VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

<img src="https://user-images.githubusercontent.com/251450/52922829-23614e00-335f-11e9-8d33-3dae30ea4a9a.gif" width="400" height="255">

_True snippet and additional text edit support_

Checkout [doc/coc.txt](doc/coc.txt) for vim interface.

## Why?

- 🚀 **Fast**: [instant increment completion](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources#highlights-of-coc-completion), increment buffer sync using buffer update events.
- 💎 **Reliable**: typed language, tested with CI.
- 🌟 **Featured**: [full LSP support](https://github.com/neoclide/coc.nvim/wiki/Language-servers#supported-features)
- ❤️ **Flexible**: [configured as VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file), [extensions works like VSCode](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

## Completion experience

You might wondering why another completion engine since there're already
widely used [YouCompleteMe](https://github.com/Valloric/YouCompleteMe) and
[deoplete.nvim](https://github.com/Shougo/deoplete.nvim).

Below is the reasons that lead to coc.nvim build it's own engine:

- **Full LSP completion support**, especially snippet and `additionalTextEdit`
  feature, you'll understand why it's awesome when you experience it with
  coc extension like `coc-tsserver`.
- **Asynchronous and parallel completion request**, unless using vim sources,
  your vim will never blocked.
- **Does completion resolve on completion item change**. The detail from complete
  item is echoed after selected, this feature requires `CompleteChanged` autocmd
  to work.
- **Incomplete request and cancel request support**, only incomplete complete
  request would be trigger on filter complete items and cancellation request is
  send to servers when necessary.
- **Start completion without timer**. The completion would start after you type
  first letter of word by default, and filtered with new input when completion
  finished, while some completion engine use timer to trigger completion and you
  always have to wait after type character.
- **Realtime buffer keywords**. Coc generate buffer keywords on buffer change in
  background (with debounce), while some completion engines use cache which could
  be wrong sometimes. And [Locality bonus feature](https://code.visualstudio.com/docs/editor/intellisense#_locality-bonus)
  from VSCode is enabled by default.
- **Filter completion items when possible.** When your does fuzzy filter with
  completion items, some completion engines would trigger new completion, but
  coc.nvim filter the items when possible which makes it much faster. Filter
  completion items on backspace is also supported.

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
  Plug 'neoclide/coc.nvim', {'tag': '*', 'do': 'yarn install'}
  ```

  to your `.vimrc` or `init.vim`, restart vim and run `:PlugInstall`.

  For other plugin manager, run command `:call coc#util#build()` to build
  coc from source code.

  **Note:** for vim user, global installed [vim-node-rpc](https://github.com/neoclide/vim-node-rpc) module required.

  **Note:** to build from master, don't use `'tag': '*'` in `Plug` command.

  **Note**: The first time of building from source code could be slow.

- [Completion with sources](https://github.com/neoclide/coc.nvim/wiki/Completion-with-sources)

- [Using snippets](https://github.com/neoclide/coc.nvim/wiki/Using-snippets)

- [Using extensions](https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions)

- [Using list](https://github.com/neoclide/coc.nvim/wiki/Using-coc-list)

- [Using configuration file](https://github.com/neoclide/coc.nvim/wiki/Using-configuration-file)

- [Language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers)

  - [Supported features](https://github.com/neoclide/coc.nvim/wiki/Language-servers#supported-features)
  - [Register custom language servers](https://github.com/neoclide/coc.nvim/wiki/Language-servers#register-custom-language-servers)

    - [Dart](https://github.com/neoclide/coc.nvim/wiki/Language-servers#dart)
    - [Flow](https://github.com/neoclide/coc.nvim/wiki/Language-servers#flow)
    - [C/C++/Objective-C](https://github.com/neoclide/coc.nvim/wiki/Language-servers#ccobjective-c)
    - [Go](https://github.com/neoclide/coc.nvim/wiki/Language-servers#go)
    - [PHP](https://github.com/neoclide/coc.nvim/wiki/Language-servers#php)
    - [Dockerfile](https://github.com/neoclide/coc.nvim/wiki/Language-servers#dockerfile)
    - [Bash](https://github.com/neoclide/coc.nvim/wiki/Language-servers#bash)
    - [Lua](https://github.com/neoclide/coc.nvim/wiki/Language-servers#lua)
    - [OCaml and ReasonML](https://github.com/neoclide/coc.nvim/wiki/Language-servers#ocaml-and-reasonml)

- [Statusline integration](https://github.com/neoclide/coc.nvim/wiki/Statusline-integration)

- [Debug language server](https://github.com/neoclide/coc.nvim/wiki/Debug-language-server)

- [Debug coc.nvim](https://github.com/neoclide/coc.nvim/wiki/Debug-coc.nvim)

- [F.A.Q](https://github.com/neoclide/coc.nvim/wiki/F.A.Q)

## Completion sources

Completion for words of buffers and file path are supported by default.

For other completion sources, check out:

- [coc-sources](https://github.com/neoclide/coc-sources): includes some common
  completion source extensions.
- [coc-neco](https://github.com/neoclide/coc-neco): viml completion support.
- [coc-neoinclude](https://github.com/jsfaint/coc-neoinclude): neoinclude
  integration.

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
- **[coc-yaml](https://github.com/neoclide/coc-yaml)** for `yaml`
- **[coc-pyls](https://github.com/neoclide/coc-pyls)** for `python`, use [Python
  Language Server](https://github.com/palantir/python-language-server)
- **[coc-highlight](https://github.com/neoclide/coc-highlight)** provide default
  document symbol highlight and colors support.
- **[coc-emmet](https://github.com/neoclide/coc-emmet)** provide emmet
  suggest in completion list.
- **[coc-snippets](https://github.com/neoclide/coc-snippets)** provide snippets
  solution.

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

" don't give |ins-completion-menu| messages.
set shortmess+=c

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

" Use <cr> for confirm completion, `<C-g>u` means break undo chain at current position.
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

" Highlight symbol under cursor on CursorHold
autocmd CursorHold * silent call CocActionAsync('highlight')

" Remap for rename current word
nmap <leader>rn <Plug>(coc-rename)

" Remap for format selected region
vmap <leader>f  <Plug>(coc-format-selected)
nmap <leader>f  <Plug>(coc-format-selected)

augroup mygroup
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')
  " Update signature help on jump placeholder
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
augroup end

" Remap for do codeAction of selected region, ex: `<leader>aap` for current paragraph
vmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap for do codeAction of current line
nmap <leader>ac  <Plug>(coc-codeaction)
" Fix autofix problem of current line
nmap <leader>qf  <Plug>(coc-fix-current)

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



" Using CocList
" Show all diagnostics
nnoremap <silent> <space>a  :<C-u>CocList diagnostics<cr>
" Manage extensions
nnoremap <silent> <space>e  :<C-u>CocList extensions<cr>
" Show commands
nnoremap <silent> <space>c  :<C-u>CocList commands<cr>
" Find symbol of current document
nnoremap <silent> <space>o  :<C-u>CocList outline<cr>
" Search workspace symbols
nnoremap <silent> <space>s  :<C-u>CocList -I symbols<cr>
" Do default action for next item.
nnoremap <silent> <space>j  :<C-u>CocNext<CR>
" Do default action for previous item.
nnoremap <silent> <space>k  :<C-u>CocPrev<CR>
" Resume latest coc list
nnoremap <silent> <space>p  :<C-u>CocListResume<CR>
```

## Feedback

- If you think it's useful, give it a star.

- If you have a question, [ask at gitter](https://gitter.im/neoclide/coc.nvim).

- If something not working, [create a issue](https://github.com/neoclide/coc.nvim/issues/new).

- If you want to help, but don't have time, [consider donate to neovim](https://salt.bountysource.com/teams/neovim) or [sponsor vim](https://www.vim.org/sponsor/index.php).

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
