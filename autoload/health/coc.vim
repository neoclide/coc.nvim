function! s:checkEnvironment() abort
  let valid = 1
  if !has('nvim') || !has('nvim-0.3.0')
    let valid = 0
    call health#report_error('Neovim version not satisfied, 0.3.0 and above required')
  endif
  if !executable('node') || !executable('npm')
    let valid = 0
    call health#report_error('Environment node.js not found, install node.js from http://nodejs.org/')
  endif
  let output = system('node -v')
  if v:shell_error && output !=# ""
    echohl Error | echon output | echohl None
    return
  endif
  let ms = matchlist(output, '^v\(\d\+\)')
  if empty(ms) || str2nr(ms[1]) < 8
    let valid = 0
    call health#report_error('Node.js version '.output.' too low, consider upgrade node.js')
  endif
  if valid
    call health#report_ok('Environment check passed')
  endif
  return valid
endfunction

function! s:checkInitailize() abort
  if get(g:, 'coc_node_channel_id', 0)
    call health#report_ok('Service initialized')
    return 1
  endif
  call health#report_error('service could not be initialized', [
        \ 'You may not have neovim package installed correctly,',
        \ 'check out https://github.com/neovim/node-client#debugging--troubleshooting',
        \])
  return 0
endfunction

function! health#coc#check() abort
    call s:checkEnvironment()
    call s:checkInitailize()
endfunction

