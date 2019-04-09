let s:root = expand('<sfile>:h:h:h')

function! s:checkEnvironment() abort
  let valid = 1
  if !has('nvim-0.3.0')
    let valid = 0
    call health#report_error('Neovim version not satisfied, 0.3.0 and above required')
  endif
  if !executable('node')
    let valid = 0
    call health#report_error('Environment node.js not found, install node.js from http://nodejs.org/')
  endif
  if !executable('yarnpkg')
    let valid = 0
    call health#report_error('Environment executable yarn not found, check https://yarnpkg.com/en/docs/install for installation.')
    call health#report_info('yarn is required for install extensions.')
  endif
  let output = system('node --version')
  if v:shell_error && output !=# ""
    echohl Error | echon output | echohl None
    return
  endif
  let ms = matchlist(output, 'v\(\d\+\).\d\+.\d\+')
  if empty(ms) || str2nr(ms[1]) < 8
    let valid = 0
    call health#report_error('Node.js version '.output.' too low, consider upgrade node.js')
  endif
  if valid
    call health#report_ok('Environment check passed')
  endif
  return valid
endfunction

function! s:checkCommand()
  let binary = coc#util#binary()
  if executable(binary) && !get(g:, 'coc_force_debug', 0)
    call health#report_ok('Binary found')
    return
  endif
  let file = s:root.'/lib/attach.js'
  if !filereadable(file)
    call health#report_error('Build javascript not found, run '':call coc#util#build()'' to fix it.')
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
