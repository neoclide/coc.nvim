scriptencoding utf-8
let s:root = expand('<sfile>:h:h:h')

function! s:report_ok(report) abort
  if has('nvim-0.10')
    call v:lua.vim.health.ok(a:report)
  else
    call health#report_ok(a:report)
  endif
endfunction

function! s:report_error(report) abort
  if has('nvim-0.10')
    call v:lua.vim.health.error(a:report)
  else
    call health#report_error(a:report)
  endif
endfunction

function! s:report_warn(report) abort
  if has('nvim-0.10')
    call v:lua.vim.health.warn(a:report)
  else
    call health#report_warn(a:report)
  endif
endfunction

function! s:checkVim(test, name, patchlevel) abort
  if a:test
    if !has(a:patchlevel)
      call s:report_error(a:name . ' version not satisfied, ' . a:patchlevel . ' and above required')
      return 0
    else
      call s:report_ok(a:name . ' version satisfied')
      return 1
    endif
  endif
  return 0
endfunction

function! s:checkEnvironment() abort
  let valid
    \ = s:checkVim(has('nvim'), 'nvim', 'nvim-0.8.0')
    \ + s:checkVim(!has('nvim'), 'vim', 'patch-9.0.0438')
  let node = get(g:, 'coc_node_path', $COC_NODE_PATH == '' ? 'node' : $COC_NODE_PATH)
  if !executable(node)
    let valid = 0
    call s:report_error('Executable node.js not found, install node.js from http://nodejs.org/')
  endif
  let output = system(node . ' --version')
  if v:shell_error && output !=# ""
    let valid = 0
    call s:report_error(output)
  endif
  let ms = matchlist(output, 'v\(\d\+\).\(\d\+\).\(\d\+\)')
  if empty(ms)
    let valid = 0
    call s:report_error('Unable to detect version of node, make sure your node executable is http://nodejs.org/')
  elseif str2nr(ms[1]) < 16 || (str2nr(ms[1]) == 16 && str2nr(ms[2]) < 18)
    let valid = 0
    call s:report_warn('Node.js version '.trim(output).' < 16.18.0, please upgrade node.js')
  endif
  if valid
    call s:report_ok('Environment check passed')
  endif
  if has('pythonx')
    try
      silent pyx print("")
    catch /.*/
      call s:report_warn('pyx command not work, some extensions may fail to work, checkout ":h pythonx"')
      if has('nvim')
        call s:report_warn('Install pynvim by command: `pip install pynvim --upgrade`')
      endif
    endtry
  endif
  return valid
endfunction

function! s:checkCommand()
  let file = s:root.'/build/index.js'
  if filereadable(file)
    call s:report_ok('Javascript bundle build/index.js found')
  else
    call s:report_error('Javascript entry not found, please compile coc.nvim by esbuild.')
  endif
endfunction

function! s:checkAutocmd()
  let cmds = ['CursorHold', 'CursorHoldI', 'CursorMovedI', 'InsertCharPre', 'TextChangedI']
  for cmd in cmds
    let lines = split(execute('verbose autocmd '.cmd), '\n')
    let n = 0
    for line in lines
      if line =~# 'CocAction(' && n < len(lines) - 1
        let next = lines[n + 1]
        let ms = matchlist(next, 'Last set from \(.*\)')
        if !empty(ms)
          call s:report_warn('Use CocActionAsync to replace CocAction for better performance on '.cmd)
          call s:report_warn('Checkout the file '.ms[1])
        endif
      endif
      let n = n + 1
    endfor
  endfor
endfunction

function! s:checkInitialize() abort
  if coc#client#is_running('coc')
    call s:report_ok('Service started')
    return 1
  endif
  call s:report_error('service could not be initialized', [
        \ 'Use command ":messages" to get error messages.',
        \ 'Open a issue at https://github.com/neoclide/coc.nvim/issues for feedback.'
        \])
  return 0
endfunction

function! health#coc#check() abort
    call s:checkEnvironment()
    call s:checkCommand()
    call s:checkInitialize()
    call s:checkAutocmd()
endfunction
