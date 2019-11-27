<p align="center">
  <a href="https://www.vim.org/scripts/script.php?script_id=5779">
    <img alt="Coc Logo" src="https://user-images.githubusercontent.com/251450/55009068-f4ed2780-501c-11e9-9a3b-cf3aa6ab9272.png" height="160" />
  </a>
  <p align="center">Make your Vim/Neovim as smart as VSCode.</p>
  <p align="center">
    <a href="/LICENSE.md"><img alt="Software License" src="https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square"></a>
    <a href="https://salt.bountysource.com/teams/coc-nvim"><img alt="Bountysource" src="https://img.shields.io/bountysource/team/coc-nvim/activity.svg?style=flat-square"></a>
    <a href="https://travis-ci.org/neoclide/coc.nvim"><img alt="Travis" src="https://img.shields.io/travis/neoclide/coc.nvim/master.svg?style=flat-square"></a>
    <a href="https://codecov.io/gh/neoclide/coc.nvim"><img alt="Coverage" src="https://img.shields.io/codecov/c/github/neoclide/coc.nvim.svg?style=flat-square"></a>
    <a href="/doc/coc.txt"><img alt="Doc" src="https://img.shields.io/badge/doc-%3Ah%20coc.txt-red.svg?style=flat-square"></a>
    <a href="https://gitter.im/neoclide/coc.nvim"><img alt="Gitter" src="https://img.shields.io/gitter/room/neoclide/coc.nvim.svg?style=flat-square"></a>
  </p>
</p>

---

Coc is an intellisense engine for Vim/Neovim.

<img alt="Gif" src="https://user-images.githubusercontent.com/251450/55285193-400a9000-53b9-11e9-8cff-ffe4983c5947.gif" width="60%" />

_True snippet and additional text editing support_

Check out [Wiki](https://github.com/neoclide/coc.nvim/wiki), or [doc/coc.txt](doc/coc.txt) for the vim interface.

## 广告

深圳全民点游有限公司急需小程序相关前端开发，有意者加我微信：chemzqm

## Quick Start

Install [nodejs](https://nodejs.org/en/download/) when necessary:

```sh
curl -sL install-node.now.sh/lts | bash
```

For [vim-plug](https://github.com/junegunn/vim-plug) users:

```vim
" Use release branch (Recommend)
Plug 'neoclide/coc.nvim', {'branch': 'release'}

" Or latest tag
Plug 'neoclide/coc.nvim', {'tag': '*', 'branch': 'release'}
" Or build from source code by use yarn: https://yarnpkg.com
Plug 'neoclide/coc.nvim', {'do': 'yarn install --frozen-lockfile'}
```

in your `.vimrc` or `init.vim`, then restart vim and run `:PlugInstall`. Checkout [Install coc.nvim](https://github.com/neoclide/coc.nvim/wiki/Install-coc.nvim) wiki for more info.

**Note**: The first time building from source code may be slow.

## Example vim configuration

Configuration is required to make coc.nvim easier to work with, since it doesn't
change your key-mappings or vim options. This is done as much as possible to avoid conflict with your
other plugins.

**❗️Important**: some vim plugins could change keymappings. Use a command like
`:verbose imap <tab>` to make sure that your keymap has taken effect.

```vim
" if hidden is not set, TextEdit might fail.
set hidden

" Some servers have issues with backup files, see #649
set nobackup
set nowritebackup

" Better display for messages
set cmdheight=2

" You will have bad experience for diagnostic messages when it's default 4000.
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

" Use <c-space> to trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current position.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
" Or use `complete_info` if your vim support it, like:
" inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"

" Use `[g` and `]g` to navigate diagnostics
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

" Remap keys for gotos
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)

" Use K to show documentation in preview window
nnoremap <silent> K :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
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
xmap <leader>f  <Plug>(coc-format-selected)
nmap <leader>f  <Plug>(coc-format-selected)

augroup mygroup
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')
  " Update signature help on jump placeholder
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
augroup end

" Remap for do codeAction of selected region, ex: `<leader>aap` for current paragraph
xmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap for do codeAction of current line
nmap <leader>ac  <Plug>(coc-codeaction)
" Fix autofix problem of current line
nmap <leader>qf  <Plug>(coc-fix-current)

" Create mappings for function text object, requires document symbols feature of languageserver.
xmap if <Plug>(coc-funcobj-i)
xmap af <Plug>(coc-funcobj-a)
omap if <Plug>(coc-funcobj-i)
omap af <Plug>(coc-funcobj-a)

" Use <C-d> for select selections ranges, needs server support, like: coc-tsserver, coc-python
nmap <silent> <C-d> <Plug>(coc-range-select)
xmap <silent> <C-d> <Plug>(coc-range-select)

" Use `:Format` to format current buffer
command! -nargs=0 Format :call CocAction('format')

" Use `:Fold` to fold current buffer
command! -nargs=? Fold :call     CocAction('fold', <f-args>)

" use `:OR` for organize import of current buffer
command! -nargs=0 OR   :call     CocAction('runCommand', 'editor.action.organizeImport')

" Add status line support, for integration with other plugin, checkout `:h coc-status`
set statusline^=%{coc#status()}%{get(b:,'coc_current_function','')}

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

## Articles

- [coc.nvim 插件体系介绍](https://zhuanlan.zhihu.com/p/65524706)
- [CocList 入坑指南](https://zhuanlan.zhihu.com/p/71846145)
- [Create coc.nvim extension to improve vim experience](https://medium.com/@chemzqm/create-coc-nvim-extension-to-improve-vim-experience-4461df269173)

## Trouble shooting

Try these steps when you have problem with coc.nvim.

- Make sure your vim version >= 8.0 by command `:version`.
- If service failed to start, use command `:CocInfo` or `:checkhealth` on neovim.
- Checkout the log of coc.nvim by command `:CocOpenLog`.
- When you have issue with a languageserver, it's recommended to [checkout the output](https://github.com/neoclide/coc.nvim/wiki/Debug-language-server#using-output-channel)

## Feedback

- If you think Coc is useful, consider giving it a star.
- If you have a question, [ask on gitter](https://gitter.im/neoclide/coc.nvim)
- 中文用户请到 [中文 gitter](https://gitter.im/neoclide/coc-cn) 讨论
- If something is not working, [create an issue](https://github.com/neoclide/coc.nvim/issues/new).

<img src="https://user-images.githubusercontent.com/251450/57566955-fb850200-7404-11e9-960f-711673f1a461.png" width="593" height="574">

## License

MIT
