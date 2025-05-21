let s:is_vim = !has('nvim')
let s:is_win = has('win32') || has('win64')
let s:is_mac = has('mac')
let s:root = expand('<sfile>:h:h:h')
let s:sign_api = exists('*sign_getplaced') && exists('*sign_place')
let s:sign_groups = []
let s:outline_preview_bufnr = 0
let s:is_win32unix = has('win32unix')

" Check <Tab> and <CR>
function! coc#ui#check_pum_keymappings(trigger) abort
  if get(g:, 'coc_disable_mappings_check', 0) == 1
    return
  endif
  if a:trigger !=# 'none'
    for key in ['<cr>', '<tab>', '<c-y>', '<s-tab>']
      let arg = maparg(key, 'i', 0, 1)
      if get(arg, 'expr', 0)
        let rhs = get(arg, 'rhs', '')
        if rhs =~# '\<pumvisible()' && rhs !~# '\<coc#pum#visible()'
          let rhs = substitute(rhs, '\Cpumvisible()', 'coc#pum#visible()', 'g')
          let rhs = substitute(rhs, '\c"\\<C-n>"', 'coc#pum#next(1)', '')
          let rhs = substitute(rhs, '\c"\\<C-p>"', 'coc#pum#prev(1)', '')
          let rhs = substitute(rhs, '\c"\\<C-y>"', 'coc#pum#confirm()', '')
          execute 'inoremap <silent><nowait><expr> '.arg['lhs'].' '.rhs
        endif
      endif
    endfor
  endif
endfunction

function! coc#ui#quickpick(title, items, cb) abort
  if exists('*popup_menu')
    function! s:QuickpickHandler(id, result) closure
      call a:cb(v:null, a:result)
    endfunction
    function! s:QuickpickFilter(id, key) closure
      for i in range(1, len(a:items))
        if a:key == string(i)
          call popup_close(a:id, i)
          return 1
        endif
      endfor
      " No shortcut, pass to generic filter
      return popup_filter_menu(a:id, a:key)
    endfunction
    try
      call popup_menu(a:items, {
        \ 'title': a:title,
        \ 'filter': function('s:QuickpickFilter'),
        \ 'callback': function('s:QuickpickHandler'),
        \ })
      redraw
    catch /.*/
      call a:cb(v:exception)
    endtry
  else
    let res = inputlist([a:title] + map(range(1, len(a:items)), 'v:val . ". " . a:items[v:val - 1]'))
    call a:cb(v:null, res)
  endif
endfunction

" cmd, cwd
function! coc#ui#open_terminal(opts) abort
  if s:is_vim && !exists('*term_start')
    echohl WarningMsg | echon "Your vim doesn't have terminal support!" | echohl None
    return
  endif
  if get(a:opts, 'position', 'bottom') ==# 'bottom'
    let p = '5new'
  else
    let p = 'vnew'
  endif
  execute 'belowright '.p.' +setl\ buftype=nofile '
  setl buftype=nofile
  setl winfixheight
  setl norelativenumber
  setl nonumber
  setl bufhidden=wipe
  if exists('#User#CocTerminalOpen')
    exe 'doautocmd <nomodeline> User CocTerminalOpen'
  endif
  let cmd = get(a:opts, 'cmd', '')
  let autoclose = get(a:opts, 'autoclose', 1)
  if empty(cmd)
    throw 'command required!'
  endif
  let cwd = get(a:opts, 'cwd', getcwd())
  let keepfocus = get(a:opts, 'keepfocus', 0)
  let bufnr = bufnr('%')
  let Callback = get(a:opts, 'Callback', v:null)

  function! s:OnExit(status) closure
    let content = join(getbufline(bufnr, 1, '$'), "\n")
    if a:status == 0 && autoclose == 1
      execute 'silent! bd! '.bufnr
    endif
    if !empty(Callback)
      call call(Callback, [a:status, bufnr, content])
    endif
  endfunction

  if s:is_vim
    if s:is_win
      let cmd = 'cmd.exe /C "'.cmd.'"'
    endif
    call term_start(cmd, {
          \ 'cwd': cwd,
          \ 'term_finish': 'close',
          \ 'exit_cb': {job, status -> s:OnExit(status)},
          \ 'curwin': 1,
          \})
  else
    call termopen(cmd, {
          \ 'cwd': cwd,
          \ 'on_exit': {job, status -> s:OnExit(status)},
          \})
  endif
  if keepfocus
    wincmd p
  endif
  return bufnr
endfunction

" run command in terminal
function! coc#ui#run_terminal(opts, cb)
  let cmd = get(a:opts, 'cmd', '')
  if empty(cmd)
    return a:cb('command required for terminal')
  endif
  let opts = {
        \ 'cmd': cmd,
        \ 'cwd': empty(get(a:opts, 'cwd', '')) ? getcwd() : a:opts['cwd'],
        \ 'keepfocus': get(a:opts, 'keepfocus', 0),
        \ 'Callback': {status, bufnr, content -> a:cb(v:null, {'success': status == 0 ? v:true : v:false, 'bufnr': bufnr, 'content': content})}
        \}
  call coc#ui#open_terminal(opts)
endfunction

function! coc#ui#fix() abort
  let file = s:root .. '/esbuild.js'
  if filereadable(file)
    let opts = {
          \ 'cmd': 'npm ci',
          \ 'cwd': s:root,
          \ 'keepfocus': 1,
          \ 'Callback': {_ -> execute('CocRestart')}
          \}
    call coc#ui#open_terminal(opts)
  endif
endfunction

function! coc#ui#echo_hover(msg)
  echohl MoreMsg
  echo a:msg
  echohl None
  let g:coc_last_hover_message = a:msg
endfunction

function! coc#ui#echo_messages(hl, msgs)
  if a:hl !~# 'Error' && (mode() !~# '\v^(i|n)$')
    return
  endif
  let msgs = filter(copy(a:msgs), '!empty(v:val)')
  if empty(msgs)
    return
  endif
  execute 'echohl '.a:hl
  echo join(msgs, "\n")
  echohl None
endfunction

function! coc#ui#preview_info(lines, filetype, ...) abort
  pclose
  keepalt new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap [Document]
  setl bufhidden=wipe
  setl nobuflisted
  setl nospell
  exe 'setl filetype='.a:filetype
  setl conceallevel=0
  setl nofoldenable
  for command in a:000
    execute command
  endfor
  call append(0, a:lines)
  exe "normal! z" . len(a:lines) . "\<cr>"
  exe "normal! gg"
  wincmd p
endfunction

function! coc#ui#open_files(files)
  let bufnrs = []
  " added on latest vim8
  for filepath in a:files
    let file = fnamemodify(coc#util#node_to_win32unix(filepath), ':.')
    if bufloaded(file)
      call add(bufnrs, bufnr(file))
    else
      let bufnr = bufadd(file)
      call bufload(file)
      call add(bufnrs, bufnr)
      call setbufvar(bufnr, '&buflisted', 1)
    endif
  endfor
  doautocmd BufEnter
  return bufnrs
endfunction

function! coc#ui#echo_lines(lines)
  echo join(a:lines, "\n")
endfunction

function! coc#ui#echo_signatures(signatures) abort
  if pumvisible() | return | endif
  echo ""
  for i in range(len(a:signatures))
    call s:echo_signature(a:signatures[i])
    if i != len(a:signatures) - 1
      echon "\n"
    endif
  endfor
endfunction

function! s:echo_signature(parts)
  for part in a:parts
    let hl = get(part, 'type', 'Normal')
    let text = get(part, 'text', '')
    if !empty(text)
      execute 'echohl '.hl
      execute "echon '".substitute(text, "'", "''", 'g')."'"
      echohl None
    endif
  endfor
endfunction

function! coc#ui#iterm_open(dir)
  return s:osascript(
      \ 'if application "iTerm2" is not running',
      \   'error',
      \ 'end if') && s:osascript(
      \ 'tell application "iTerm2"',
      \   'tell current window',
      \     'create tab with default profile',
      \     'tell current session',
      \       'write text "cd ' . a:dir . '"',
      \       'write text "clear"',
      \       'activate',
      \     'end tell',
      \   'end tell',
      \ 'end tell')
endfunction

function! s:osascript(...) abort
  let args = join(map(copy(a:000), '" -e ".shellescape(v:val)'), '')
  call  s:system('osascript'. args)
  return !v:shell_error
endfunction

function! s:system(cmd)
  let output = system(a:cmd)
  if v:shell_error && output !=# ""
    echohl Error | echom output | echohl None
    return
  endif
  return output
endfunction

function! coc#ui#set_lines(bufnr, changedtick, original, replacement, start, end, changes, cursor, col, linecount) abort
  try
    if s:is_vim
      call coc#vim9#Set_lines(a:bufnr, a:changedtick, a:original, a:replacement, a:start, a:end, a:changes, a:cursor, a:col, a:linecount)
    else
      call v:lua.require('coc.text').set_lines(a:bufnr, a:changedtick, a:original, a:replacement, a:start, a:end, a:changes, a:cursor, a:col, a:linecount)
    endif
  catch /.*/
    " Need try catch here on vim9
    call coc#compat#send_error('coc#ui#set_lines', s:is_vim)
  endtry
endfunction

function! coc#ui#change_lines(bufnr, list) abort
  if !bufloaded(a:bufnr)
    return v:null
  endif
  undojoin
  for [lnum, line] in a:list
    call setbufline(a:bufnr, lnum + 1, line)
  endfor
endfunction

function! coc#ui#open_url(url)
  if isdirectory(a:url) && $TERM_PROGRAM ==# "iTerm.app"
    call coc#ui#iterm_open(a:url)
    return
  endif
  if !empty(get(g:, 'coc_open_url_command', ''))
    call system(g:coc_open_url_command.' '.a:url)
    return
  endif
  if has('mac') && executable('open')
    call system('open "'.a:url.'"')
    return
  endif
  if executable('xdg-open')
    call system('xdg-open "'.a:url.'"')
    return
  endif
  call system('cmd /c start "" /b '. substitute(a:url, '&', '^&', 'g'))
  if v:shell_error
    echohl Error | echom 'Failed to open '.a:url | echohl None
    return
  endif
endfunction

function! coc#ui#rename_file(oldPath, newPath, write) abort
  let oldPath = coc#util#node_to_win32unix(a:oldPath)
  let newPath =  coc#util#node_to_win32unix(a:newPath)
  let bufnr = bufnr(oldPath)
  if bufnr == -1
    throw 'Unable to get bufnr of '.oldPath
  endif
  if oldPath =~? newPath && (s:is_mac || s:is_win || s:is_win32unix)
    return coc#ui#safe_rename(bufnr, oldPath, newPath, a:write)
  endif
  if bufloaded(newPath)
    execute 'silent bdelete! '.bufnr(newPath)
  endif
  " TODO use nvim_buf_set_name instead
  let current = bufnr == bufnr('%')
  let bufname = fnamemodify(newPath, ":~:.")
  let filepath = fnamemodify(bufname(bufnr), '%:p')
  let winid = coc#compat#buf_win_id(bufnr)
  let curr = -1
  if winid == -1
    let curr = win_getid()
    let file = fnamemodify(bufname(bufnr), ':.')
    execute 'keepalt tab drop '.fnameescape(bufname(bufnr))
    let winid = win_getid()
  endif
  call win_execute(winid, 'keepalt file '.fnameescape(bufname), 'silent')
  call win_execute(winid, 'doautocmd BufEnter')
  if a:write
    call win_execute(winid, 'noa write!', 'silent')
    call delete(filepath, '')
  endif
  if curr != -1
    call win_gotoid(curr)
  endif
  return bufnr
endfunction

" System is case in sensitive and newPath have different case.
function! coc#ui#safe_rename(bufnr, oldPath, newPath, write) abort
  let winid = win_getid()
  let lines = getbufline(a:bufnr, 1, '$')
  execute 'keepalt tab drop '.fnameescape(fnamemodify(a:oldPath, ':.'))
  let view = winsaveview()
  execute 'keepalt bwipeout! '.a:bufnr
  if a:write
    call delete(a:oldPath, '')
  endif
  execute 'keepalt edit '.fnameescape(fnamemodify(a:newPath, ':~:.'))
  let bufnr = bufnr('%')
  call coc#compat#buf_set_lines(bufnr, 0, -1, lines)
  if a:write
    execute 'noa write'
  endif
  call winrestview(view)
  call win_gotoid(winid)
  return bufnr
endfunction

function! coc#ui#sign_unplace() abort
  if exists('*sign_unplace')
    for group in s:sign_groups
      call sign_unplace(group)
    endfor
  endif
endfunction

function! coc#ui#update_signs(bufnr, group, signs) abort
  if !s:sign_api || !bufloaded(a:bufnr)
    return
  endif
  call sign_unplace(a:group, {'buffer': a:bufnr})
  for def in a:signs
    let opts = {'lnum': def['lnum']}
    if has_key(def, 'priority')
      let opts['priority'] = def['priority']
    endif
    call sign_place(0, a:group, def['name'], a:bufnr, opts)
  endfor
endfunction

function! coc#ui#outline_preview(config) abort
  let view_id = get(w:, 'cocViewId', '')
  if view_id !=# 'OUTLINE'
    return
  endif
  let wininfo = get(getwininfo(win_getid()), 0, v:null)
  if empty(wininfo)
    return
  endif
  let border = get(a:config, 'border', v:true)
  let th = &lines - &cmdheight - 2
  let range = a:config['range']
  let height = min([range['end']['line'] - range['start']['line'] + 1, th - 4])
  let to_left = &columns - wininfo['wincol'] - wininfo['width'] < wininfo['wincol']
  let start_lnum = range['start']['line'] + 1
  let end_lnum = range['end']['line'] + 1 - start_lnum > &lines ? start_lnum + &lines : range['end']['line'] + 1
  let lines = getbufline(a:config['bufnr'], start_lnum, end_lnum)
  let content_width = max(map(copy(lines), 'strdisplaywidth(v:val)'))
  let width = min([content_width, a:config['maxWidth'], to_left ? wininfo['wincol'] - 3 : &columns - wininfo['wincol'] - wininfo['width']])
  let filetype = getbufvar(a:config['bufnr'], '&filetype')
  let cursor_row = coc#cursor#screen_pos()[0]
  let config = {
      \ 'relative': 'editor',
      \ 'row': cursor_row - 1 + height < th ? cursor_row - (border ? 1 : 0) : th - height - (border ? 1 : -1),
      \ 'col': to_left ? wininfo['wincol'] - 4 - width : wininfo['wincol'] + wininfo['width'],
      \ 'width': width,
      \ 'height': height,
      \ 'lines': lines,
      \ 'border': border ? [1,1,1,1] : v:null,
      \ 'rounded': get(a:config, 'rounded', 1) ? 1 : 0,
      \ 'winblend': a:config['winblend'],
      \ 'highlight': a:config['highlight'],
      \ 'borderhighlight': a:config['borderhighlight'],
      \ }
  let winid = coc#float#get_float_by_kind('outline-preview')
  let result = coc#float#create_float_win(winid, s:outline_preview_bufnr, config)
  if empty(result)
    return v:null
  endif
  call setwinvar(result[0], 'kind', 'outline-preview')
  let s:outline_preview_bufnr = result[1]
  if !empty(filetype)
    call win_execute(result[0], 'setfiletype '.filetype)
  endif
  return result[1]
endfunction

function! coc#ui#outline_close_preview() abort
  let winid = coc#float#get_float_by_kind('outline-preview')
  if winid
    call coc#float#close(winid)
  endif
endfunction

" Ignore error from autocmd when file opened
function! coc#ui#safe_open(cmd, file) abort
  let bufname = fnameescape(a:file)
  try
    execute 'silent! '. a:cmd.' '.bufname
  catch /.*/
    if bufname('%') != bufname
      throw 'Error on open '. v:exception
    endif
  endtry
endfunction

" Use noa to setloclist, avoid BufWinEnter autocmd
function! coc#ui#setloclist(nr, items, action, title) abort
  let items = s:is_win32unix ? map(copy(a:items), 's:convert_qfitem(v:val)'): a:items
  if a:action ==# ' '
    let title = get(getloclist(a:nr, {'title': 1}), 'title', '')
    let action = title ==# a:title ? 'r' : ' '
    noa call setloclist(a:nr, [], action, {'title': a:title, 'items': items})
  else
    noa call setloclist(a:nr, [], a:action, {'title': a:title, 'items': items})
  endif
endfunction

function! s:convert_qfitem(item) abort
  let result = copy(a:item)
  if has_key(result, 'filename')
    let result['filename'] = coc#util#node_to_win32unix(result['filename'])
  endif
  return result
endfunction

function! coc#ui#get_mouse() abort
  if get(g:, 'coc_node_env', '') ==# 'test'
    return get(g:, 'mouse_position', [win_getid(), line('.'), col('.')])
  endif
  return [v:mouse_winid,v:mouse_lnum,v:mouse_col]
endfunction

" viewId - identifier of tree view
" bufnr - bufnr tree view
" winid - winid of tree view
" bufname -  bufname of tree view
" command - split command
" optional options - bufhidden, canSelectMany, winfixwidth
function! coc#ui#create_tree(opts) abort
  let viewId = a:opts['viewId']
  let bufname = a:opts['bufname']
  let tabid = coc#compat#tabnr_id(tabpagenr())
  let winid = s:get_tree_winid(a:opts)
  let bufnr = a:opts['bufnr']
  if !bufloaded(bufnr)
    let bufnr = -1
  endif
  if winid != -1
    call win_gotoid(winid)
    if bufnr('%') == bufnr
      return [bufnr, winid, tabid]
    elseif bufnr != -1
      execute 'silent keepalt buffer '.bufnr
    else
      execute 'silent keepalt edit +setl\ buftype=nofile '.bufname
      call s:set_tree_defaults(a:opts)
    endif
  else
    " need to split
    let cmd = get(a:opts, 'command', 'belowright 30vs')
    execute 'silent keepalt '.cmd.' +setl\ buftype=nofile '.bufname
    call s:set_tree_defaults(a:opts)
    let winid = win_getid()
  endif
  let w:cocViewId = viewId
  return [winbufnr(winid), winid, tabid]
endfunction

" valid window id or -1
function! s:get_tree_winid(opts) abort
  let viewId = a:opts['viewId']
  let winid = a:opts['winid']
  if winid != -1 && coc#window#visible(winid)
    return winid
  endif
  if winid != -1
    call win_execute(winid, 'noa close!', 'silent!')
  endif
  return coc#window#find('cocViewId', viewId)
endfunction

function! s:set_tree_defaults(opts) abort
  let bufhidden = get(a:opts, 'bufhidden', 'wipe')
  let signcolumn = get(a:opts, 'canSelectMany', v:false) ? 'yes' : 'no'
  let winfixwidth = get(a:opts, 'winfixwidth', v:false) ? ' winfixwidth' : ''
  execute 'setl bufhidden='.bufhidden.' signcolumn='.signcolumn.winfixwidth
  setl nolist nonumber norelativenumber foldcolumn=0
  setl nocursorline nobuflisted wrap undolevels=-1 filetype=coctree nomodifiable noswapfile
endfunction
