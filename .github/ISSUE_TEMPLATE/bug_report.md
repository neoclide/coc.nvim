---
name: Bug report
about: Create a report to help us improve
---

<!--
If you have question, please ask at https://gitter.im/neoclide/coc.nvim

If the problem related to specific language server, please checkout: https://git.io/fjCEM

If your have performance issue, checkout: https://git.io/fjCEX & https://git.io/fjCE1
-->

## Result from CocInfo

<!--Run `:CocInfo` command and paste the content below.-->

## Describe the bug

A clear and concise description of what the bug is.

## Reproduce the bug

**Note**, if you can't provide minimal vimrc that could reproduce the issue,
it's most likely we can't do anything to help.

- Create file `mini.vim` with：

  ```vim
  set nocompatible
  set runtimepath^=/path/to/coc.nvim
  filetype plugin indent on
  syntax on
  set hidden
  ```

- Start (neo)vim with command: `vim -u mini.vim`

- Operate vim.

## Screenshots (optional)

If applicable, add screenshots to help explain your problem.
