---
name: Bug report
about: Create a report to help us improve
---

<!--
If the problem related to specific language server, please checkout:
https://github.com/neoclide/coc.nvim/wiki/Debug-language-server#using-output-channel
-->

**Result from CocInfo**

<!--Run `:CocInfo` command and paste the content below.-->

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**

**Note**, if you can't provide minimal vimrc that could reproduce the issue,
it's most likely we can't do anything to help.

- Create a minimal mini.vim with：

  ```vim
  set nocompatible
  set runtimepath^=/path/to/coc.nvim
  filetype plugin indent on
  syntax on
  set hidden
  ```

- Start vim with command: `vim -u mini.vim`

- Start neovim with command: `nvim -u mini.vim`

- Operate vim.

**Screenshots**
If applicable, add screenshots to help explain your problem.
