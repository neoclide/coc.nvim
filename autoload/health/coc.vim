let s:root = expand('<sfile>:h:h:h')

function! s:checkEnvironment() abort
  let valid = 1
  if !has('nvim-0.3.0')
    let valid = 0
    call health#report_error('Neovim version not satisfied, 0.3.0 and above required')
  endif
  let node = get(g:, 'coc_node_path', 'node')
  if !executable(node)
    let valid = 0
    call health#report_error('Executable node.js not found, install node.js from http://nodejs.org/')
  endif
  let output = system(node . ' --version')
  if v:shell_error && output !=# ""
    echohl Error | echom output | echohl None
    return
  endif
  let ms = matchlist(output, 'v\(\d\+\).\(\d\+\).\(\d\+\)')
  if empty(ms) || str2nr(ms[1]) < 8 || (str2nr(ms[1]) == 8 && str2nr(ms[2]) < 10)
    let valid = 0
    call health#report_error('Node.js version '.output.' < 8.10.0, please upgrade node.js')
  endif
  if valid
    call health#report_ok('Environment check passed')
  endif
  if has('pythonx')
    try
      silent pyx print("")
    catch /.*/
      call health#report_warn('pyx command not work, some extensions may fail to work, checkout ":h pythonx"')
    endtry
  endif
  return valid
endfunction

function! s:checkCommand()
  let file = s:root.'/build/index.js'
  if filereadable(file) && !get(g:, 'coc_force_debug', 0)
    call health#report_ok('Javascript bundle found')
    return
  endif
  let file = s:root.'/lib/attach.js'
  if !filereadable(file)
    call health#report_error('Javascript entry not found, run ":call coc#util#install()" to fix it.')
  else
    call health#report_ok('Build javascript found')
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
          call health#report_warn('Use CocActionAsync to replace CocAction for better performance on '.cmd)
          call health#report_warn('Checkout the file '.ms[1])
        endif
      endif
      let n = n + 1
    endfor
  endfor
endfunction

function! s:checkInitailize() abort
  if coc#client#is_running('coc')
    call health#report_ok('Service started')
    return 1
  endif
  call health#report_error('service could not be initialized', [
        \ 'Use command ":messages" to get error messages.',
        \ 'Open a issue at https://github.com/neoclide/coc.nvim/issues for feedback.'
        \])
  return 0
endfunction

function! health#coc#check() abort
    call s:checkEnvironment()
    call s:checkCommand()
    call s:checkInitailize()
    call s:checkAutocmd()
endfunction
