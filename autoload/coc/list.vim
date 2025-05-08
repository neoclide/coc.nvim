scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:prefix = '[List Preview]'
let s:sign_group = 'CocList'
" filetype detect could be slow.
let s:filetype_map = {
      \ 'c': 'c',
      \ 'py': 'python',
      \ 'vim': 'vim',
      \ 'ts': 'typescript',
      \ 'js': 'javascript',
      \ 'html': 'html',
      \ 'css': 'css'
      \ }
let s:pwinid = -1
let s:pbufnr = -1
let s:sign_range = 'CocCursorLine'
let s:sign_popup_range = 'PopUpCocList'
let s:current_line_hl = 'CocListCurrent'

function! coc#list#getchar() abort
  return coc#prompt#getchar()
endfunction

function! coc#list#setlines(bufnr, lines, append)
  if a:append
    silent call appendbufline(a:bufnr, '$', a:lines)
  else
    if exists('*deletebufline')
      silent call deletebufline(a:bufnr, len(a:lines) + 1, '$')
    else
      let n = len(a:lines) + 1
      let saved_reg = @"
      silent execute n.',$d'
      let @" = saved_reg
    endif
    silent call setbufline(a:bufnr, 1, a:lines)
  endif
endfunction

function! coc#list#options(...)
  let list = ['--top', '--tab', '--buffer', '--workspace-folder', '--normal', '--no-sort',
   \ '--input=', '--strict', '--regex', '--interactive', '--number-select',
   \ '--auto-preview', '--ignore-case', '--no-quit', '--first', '--reverse', '--height=']
  if get(g:, 'coc_enabled', 0)
    let names = coc#rpc#request('listNames', [])
    call extend(list, names)
  endif
  return join(list, "\n")
endfunction

function! coc#list#names(...) abort
  let names = coc#rpc#request('listNames', [])
  return join(names, "\n")
endfunction

function! coc#list#status(name)
  if !exists('b:list_status') | return '' | endif
  return get(b:list_status, a:name, '')
endfunction

function! coc#list#create(position, height, name, numberSelect)
  if a:position ==# 'tab'
    call coc#ui#safe_open('silent tabe', 'list:///'.a:name)
  else
    call s:save_views(-1)
    let height = max([1, a:height])
    let cmd = 'silent keepalt '.(a:position ==# 'top' ? '' : 'botright').height.'sp'
    call coc#ui#safe_open(cmd, 'list:///'.a:name)
    call s:set_height(height)
    call s:restore_views()
  endif
  if a:numberSelect
    setl norelativenumber
    setl number
  else
    setl nonumber
    setl norelativenumber
  endif
  if exists('&winfixbuf')
    setl winfixbuf
  endif
  setl colorcolumn=""
  return [bufnr('%'), win_getid(), tabpagenr()]
endfunction

" close list windows
function! coc#list#clean_up() abort
  for i in range(1, winnr('$'))
    let bufname = bufname(winbufnr(i))
    if bufname =~# 'list://'
      execute i.'close!'
    endif
  endfor
endfunction

function! coc#list#setup(source)
  let b:list_status = {}
  setl buftype=nofile nobuflisted nofen nowrap
  setl norelativenumber bufhidden=wipe nocursorline winfixheight
  setl tabstop=1 nolist nocursorcolumn undolevels=-1
  setl signcolumn=auto
  setl foldcolumn=0
  if exists('&cursorlineopt')
    setl cursorlineopt=both
  endif
  if s:is_vim
    setl nocursorline
  else
    setl cursorline
    setl winhighlight=CursorLine:CocListLine
  endif
  setl scrolloff=0
  setl filetype=list
  syntax case ignore
  let source = a:source[8:]
  let name = toupper(source[0]).source[1:]
  execute 'syntax match Coc'.name.'Line /\v^.*$/'
  if !s:is_vim
    " Repeat press <C-f> and <C-b> would invoke <esc> on vim
    nnoremap <silent><nowait><buffer> <esc> <C-w>c
  endif
endfunction

function! coc#list#close(winid, position, target_win, saved_height) abort
  let tabnr = coc#window#tabnr(a:winid)
  if a:position ==# 'tab'
    if tabnr != -1
      call coc#list#close_preview(tabnr, 0)
    endif
    call coc#window#close(a:winid)
  else
    call s:save_views(a:winid)
    if tabnr != -1
      call coc#list#close_preview(tabnr, 0)
    endif
    if type(a:target_win) == v:t_number
      call win_gotoid(a:target_win)
    endif
    call coc#window#close(a:winid)
    call s:restore_views()
    if type(a:saved_height) == v:t_number
      call coc#window#set_height(a:target_win, a:saved_height)
    endif
    " call coc#rpc#notify('Log', ["close", a:target_win, v])
  endif
endfunction

function! coc#list#select(bufnr, line) abort
  if s:is_vim && !empty(a:bufnr) && bufloaded(a:bufnr)
    call sign_unplace(s:sign_group, { 'buffer': a:bufnr })
    if a:line > 0
      call sign_place(6, s:sign_group, s:current_line_hl, a:bufnr, {'lnum': a:line})
    endif
  endif
endfunction

" Check if previewwindow exists on current tab.
function! coc#list#has_preview()
  if s:pwinid != -1 && coc#window#visible(s:pwinid)
    return 1
  endif
  for i in range(1, winnr('$'))
    let preview = getwinvar(i, 'previewwindow', getwinvar(i, '&previewwindow', 0))
    if preview
      return i
    endif
  endfor
  return 0
endfunction

" Get previewwindow from tabnr, use 0 for current tab
function! coc#list#get_preview(...) abort
  if s:pwinid != -1 && coc#window#visible(s:pwinid)
    return s:pwinid
  endif
  let tabnr = get(a:, 1, 0) == 0 ? tabpagenr() : a:1
  let info = gettabinfo(tabnr)
  if !empty(info)
    for win in info[0]['windows']
      if gettabwinvar(tabnr, win, 'previewwindow', 0)
        return win
      endif
    endfor
  endif
  return -1
endfunction

function! coc#list#scroll_preview(dir, floatPreview) abort
  let winid = coc#list#get_preview()
  if winid == -1
    return
  endif
  if a:floatPreview
    let forward = a:dir ==# 'up' ? 0 : 1
    let amount = 1
    if s:is_vim
      call coc#float#scroll_win(winid, forward, amount)
    else
      call timer_start(0, { -> coc#float#scroll_win(winid, forward, amount)})
    endif
    return
  endif
  call win_execute(winid, "normal! ".(a:dir ==# 'up' ? "\<C-u>" : "\<C-d>"))
endfunction

function! coc#list#close_preview(...) abort
  let tabnr = get(a:, 1, tabpagenr())
  let winid = coc#list#get_preview(tabnr)
  if winid != -1
    let keep = get(a:, 2, 1) && tabnr == tabpagenr() && !coc#window#is_float(winid)
    if keep
      call s:save_views(winid)
    endif
    call coc#window#close(winid)
    if keep
      call s:restore_views()
    endif
  endif
endfunction

function! s:get_preview_lines(lines, config) abort
  if empty(a:lines)
    if get(a:config, 'scheme', 'file') !=# 'file'
      let bufnr = s:load_buffer(get(a:config, 'name', ''))
      return bufnr == 0 ? [''] : getbufline(bufnr, 1, '$')
    else
      return ['']
    endif
  endif
  return a:lines
endfunction

function! coc#list#float_preview(lines, config) abort
  let position = get(a:config, 'position', 'bottom')
  if position ==# 'tab'
    throw 'unable to use float preview'
  endif
  let remain = 0
  let winrow = win_screenpos(winnr())[0]
  if position ==# 'bottom'
    let remain = winrow - 2
  else
    let winbottom = winrow + winheight(winnr())
    let remain = &lines - &cmdheight - 1 - winbottom
  endif
  let lines = s:get_preview_lines(a:lines, a:config)
  let height = s:get_preview_height(lines, a:config)
  let height = min([remain, height + 2])
  if height < 0
    return
  endif
  let row = position ==# 'bottom' ? winrow - 3 - height : winrow + winheight(winnr())
  let title = fnamemodify(get(a:config, 'name', ''), ':.')
  let total = get(get(b:, 'list_status', {}), 'total', 0)
  if !empty(total)
    let title .= ' ('.line('.').'/'.total.')'
  endif
  let lnum = min([get(a:config, 'lnum', 1), len(lines)])
  let opts = {
      \ 'relative': 'editor',
      \ 'width': winwidth(winnr()) - 2,
      \ 'borderhighlight': 'MoreMsg',
      \ 'highlight': 'Normal',
      \ 'height': height,
      \ 'col': 0,
      \ 'index': lnum - 1,
      \ 'row': row,
      \ 'border': [1,1,1,1],
      \ 'rounded': 1,
      \ 'lines': lines,
      \ 'scrollinside': 1,
      \ 'title': title,
      \ }
  let result = coc#float#create_float_win(s:pwinid, s:pbufnr, opts)
  if empty(result)
    return
  endif
  let s:pwinid = result[0]
  let s:pbufnr = result[1]
  call setwinvar(s:pwinid, 'previewwindow', 1)
  let topline = s:get_topline(a:config, lnum, height)
  call coc#window#restview(s:pwinid, lnum, topline)
  call s:preview_highlights(s:pwinid, s:pbufnr, a:config, 1)
endfunction

" Improve preview performance by reused window & buffer.
" lines - list of lines
" config.position - could be 'bottom' 'top' 'tab'.
" config.winid - id of original window.
" config.name - (optional )name of preview buffer.
" config.splitRight - (optional) split to right when 1.
" config.lnum - (optional) current line number
" config.filetype - (optional) filetype of lines.
" config.range - (optional) highlight range. with hlGroup.
" config.hlGroup - (optional) highlight group.
" config.maxHeight - (optional) max height of window, valid for 'bottom' & 'top' position.
function! coc#list#preview(lines, config) abort
  let lines = s:get_preview_lines(a:lines, a:config)
  let winid = coc#list#get_preview(0)
  let bufnr = winid == -1 ? 0 : winbufnr(winid)
  " Try reuse buffer & window
  let bufnr = coc#float#create_buf(bufnr, lines)
  if bufnr == 0
    return
  endif
  let lnum = get(a:config, 'lnum', 1)
  let position = get(a:config, 'position', 'bottom')
  let original = get(a:config, 'winid', -1)
  if winid == -1
    let change = position != 'tab' && get(a:config, 'splitRight', 0)
    let curr = win_getid()
    if change
      if original && win_id2win(original)
        noa call win_gotoid(original)
      else
        noa wincmd t
      endif
      execute 'noa belowright vert sb '.bufnr
      let winid = win_getid()
    elseif position == 'tab' || get(a:config, 'splitRight', 0)
      execute 'noa belowright vert sb '.bufnr
      let winid = win_getid()
    else
      let mod = position == 'top' ? 'below' : 'above'
      let height = s:get_preview_height(lines, a:config)
      call s:save_views(-1)
      execute 'noa '.mod.' sb +resize\ '.height.' '.bufnr
      call s:restore_views()
      let winid = win_getid()
    endif
    call setbufvar(bufnr, '&synmaxcol', 500)
    noa call winrestview({"lnum": lnum ,"topline":s:get_topline(a:config, lnum, winheight(winid))})
    call s:set_preview_options(winid)
    noa call win_gotoid(curr)
  else
    let height = s:get_preview_height(lines, a:config)
    if height > 0
      if s:is_vim
        let curr = win_getid()
        noa call win_gotoid(winid)
        execute 'silent! noa resize '.height
        noa call win_gotoid(curr)
      else
        call s:save_views(winid)
        call nvim_win_set_height(winid, height)
        call s:restore_views()
      endif
    endif
    call coc#window#restview(winid, lnum, s:get_topline(a:config, lnum, height))
  endif
  call s:preview_highlights(winid, bufnr, a:config, 0)
endfunction

function! s:preview_highlights(winid, bufnr, config, float) abort
  let name = fnamemodify(get(a:config, 'name', ''), ':.')
  let newname = s:prefix.' '.name
  if newname !=# bufname(a:bufnr)
    if s:is_vim
      call win_execute(a:winid, 'noa file '.fnameescape(newname), 'silent!')
    else
      silent! noa call nvim_buf_set_name(a:bufnr, newname)
    endif
  endif

  let filetype = get(a:config, 'filetype', '')
  let extname = matchstr(name, '\.\zs[^.]\+$')
  if empty(filetype) && !empty(extname)
    let filetype = get(s:filetype_map, extname, '')
  endif
  " highlights
  let sign_group = s:is_vim && a:float ? s:sign_popup_range : s:sign_range
  call win_execute(a:winid, ['syntax clear', 'call clearmatches()'])
  call sign_unplace(sign_group, {'buffer': a:bufnr})
  let lnum = get(a:config, 'lnum', 1)
  if !empty(filetype)
    if get(g:, 'coc_list_preview_filetype', 0)
      call win_execute(a:winid, 'setf '.filetype)
    else
      let start = max([0, lnum - 300])
      let end = min([coc#compat#buf_line_count(a:bufnr), lnum + 300])
      call coc#highlight#highlight_lines(a:winid, [{'filetype': filetype, 'startLine': start, 'endLine': end}])
      call win_execute(a:winid, 'syn sync fromstart')
    endif
  else
    call win_execute(a:winid, 'filetype detect')
    let ft = getbufvar(a:bufnr, '&filetype', '')
    if !empty(extname) && !empty(ft)
      let s:filetype_map[extname] = ft
    endif
  endif
  " selection range
  let targetRange = get(a:config, 'targetRange', v:null)
  if !empty(targetRange)
    for lnum in range(targetRange['start']['line'] + 1, targetRange['end']['line'] + 1)
      call sign_place(0, sign_group, s:current_line_hl, a:bufnr, {'lnum': lnum})
    endfor
  endif
  let range = get(a:config, 'range', v:null)
  if !empty(range)
    let hlGroup = get(a:config, 'hlGroup', 'Search')
    call coc#highlight#match_ranges(a:winid, a:bufnr, [range], hlGroup, 10)
  endif
endfunction

function! s:get_preview_height(lines, config) abort
  if get(a:config, 'splitRight', 0) || get(a:config, 'position', 'bottom') == 'tab'
    return 0
  endif
  let height = min([get(a:config, 'maxHeight', 10), len(a:lines), &lines - &cmdheight - 2])
  return height
endfunction

function! s:load_buffer(name) abort
  if exists('*bufadd') && exists('*bufload')
    let bufnr = bufadd(a:name)
    call bufload(bufnr)
    return bufnr
  endif
  return 0
endfunction

function! s:get_topline(config, lnum, winheight) abort
  let toplineStyle = get(a:config, 'toplineStyle', 'offset')
  if toplineStyle == 'middle'
    return max([1, a:lnum - a:winheight/2])
  endif
  let toplineOffset = get(a:config, 'toplineOffset', 3)
  return max([1, a:lnum - toplineOffset])
endfunction

function! s:set_preview_options(winid) abort
  call setwinvar(a:winid, '&foldmethod', 'manual')
  call setwinvar(a:winid, '&foldenable', 0)
  call setwinvar(a:winid, '&signcolumn', 'no')
  call setwinvar(a:winid, '&number', 1)
  call setwinvar(a:winid, '&cursorline', 0)
  call setwinvar(a:winid, '&relativenumber', 0)
  call setwinvar(a:winid, 'previewwindow', 1)
endfunction

" save views on current tabpage
function! s:save_views(exclude) abort
  " Not work as expected when cursor becomes hidden
  if s:is_vim
    return
  endif
  for nr in range(1, winnr('$'))
    let winid = win_getid(nr)
    if winid != a:exclude && getwinvar(nr, 'previewwindow', 0) == 0 && !coc#window#is_float(winid)
      call win_execute(winid, 'let w:coc_list_saved_view = winsaveview()')
    endif
  endfor
endfunction

function! s:restore_views() abort
  if s:is_vim
    return
  endif
  for nr in range(1, winnr('$'))
    let saved = getwinvar(nr, 'coc_list_saved_view', v:null)
    if !empty(saved)
      let winid = win_getid(nr)
      call win_execute(winid, 'noa call winrestview(w:coc_list_saved_view) | unlet w:coc_list_saved_view')
    endif
  endfor
endfunction

function! s:set_height(height) abort
  let curr = winheight(0)
  if curr != a:height
    execute 'resize '.a:height
  endif
endfunction
