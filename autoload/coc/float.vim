" Related to float window create
let s:is_vim = !has('nvim')
let s:borderchars = get(g:, 'coc_borderchars',
      \ ['─', '│', '─', '│', '┌', '┐', '┘', '└'])
let s:prompt_win_width = get(g:, 'coc_prompt_win_width', 32)
let s:scrollbar_ns = exists('*nvim_create_namespace') ?  nvim_create_namespace('coc-scrollbar') : 0
" winvar: border array of numbers,  button boolean

function! coc#float#get_float_mode(lines, config) abort
  let allowSelection = get(a:config, 'allowSelection', 0)
  let pumAlignTop = get(a:config, 'pumAlignTop', 0)
  let mode = mode()
  let checked = (mode == 's' && allowSelection) || index(['i', 'n', 'ic'], mode) != -1
  if !checked
    return v:null
  endif
  if !s:is_vim && mode ==# 'i'
    " helps to fix undo issue, don't know why.
    call feedkeys("\<C-g>u", 'n')
  endif
  let dimension = coc#float#calculate_dimension(a:lines, a:config)
  if empty(dimension)
    return v:null
  endif
  if pumvisible() && ((pumAlignTop && dimension['row'] <0)|| (!pumAlignTop && dimension['row'] > 0))
    return v:null
  endif
  return [mode, bufnr('%'), [line('.'), col('.')], dimension]
endfunction

" create/reuse float window for config position.
function! coc#float#create_float_win(winid, bufnr, config) abort
  call coc#float#close_auto_hide_wins(a:winid)
  " use exists
  if a:winid && coc#float#valid(a:winid)
    if s:is_vim
      let [line, col] = s:popup_position(a:config)
      call popup_move(a:winid, {
            \ 'line': line,
            \ 'col': col,
            \ 'minwidth': a:config['width'] - 2,
            \ 'minheight': a:config['height'],
            \ 'maxwidth': a:config['width'] - 2,
            \ 'maxheight': a:config['height'],
            \ })
      let opts = {
            \ 'cursorline': get(a:config, 'cursorline', 0),
            \ 'title': get(a:config, 'title', ''),
            \ }
      if has_key(a:config, 'border')
        let opts['border'] = a:config['border']
      endif
      call popup_setoptions(a:winid, opts)
      return [a:winid, winbufnr(a:winid)]
    else
      let config = s:convert_config_nvim(a:config)
      " not reuse related windows
      call coc#float#nvim_close_related(a:winid)
      call nvim_win_set_config(a:winid, config)
      call coc#float#nvim_create_related(a:winid, config, a:config)
      return [a:winid, winbufnr(a:winid)]
    endif
  endif
  let winid = 0
  if s:is_vim
    let [line, col] = s:popup_position(a:config)
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let title = get(a:config, 'title', '')
    let opts = {
          \ 'title': title,
          \ 'line': line,
          \ 'col': col,
          \ 'padding': empty(title) ?  [0, 1, 0, 1] : [0, 0, 0, 0],
          \ 'borderchars': s:borderchars,
          \ 'highlight': 'CocFloating',
          \ 'fixed': 1,
          \ 'cursorline': get(a:config, 'cursorline', 0),
          \ 'minwidth': a:config['width'] - 2,
          \ 'minheight': a:config['height'],
          \ 'maxwidth': a:config['width'] - 2,
          \ 'maxheight': a:config['height']
          \ }
    if get(a:config, 'close', 0)
      let opts['close'] = 'button'
    endif
    if has_key(a:config, 'border')
      let opts['border'] = a:config['border']
    endif
    let winid = popup_create(bufnr, opts)
    if winid == 0
      return []
    endif
    if has("patch-8.1.2281")
      call setwinvar(winid, '&showbreak', 'NONE')
    endif
  else
    " Note that width is total width, but height is content height
    let config = s:convert_config_nvim(a:config)
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let winid = nvim_open_win(bufnr, 0, config)
    if winid == 0
      return []
    endif
    call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating,CursorLine:CocMenuSel')
    call setwinvar(winid, '&signcolumn', 'no')
    if !get(get(a:config, 'border', []), 3, 0)
      call setwinvar(winid, '&foldcolumn', 1)
    endif
    call coc#float#nvim_create_related(winid, config, a:config)
  endif
  if !s:is_vim
    " change cursorline option affects vim's own highlight
    call setwinvar(winid, '&cursorline', get(a:config, 'cursorline', 0))
    call setwinvar(winid, 'border', get(a:config, 'border', []))
  endif
  if get(a:config, 'autohide', 0)
    call setwinvar(winid, 'autohide', 1)
  endif
  if s:is_vim || has('nvim-0.5.0')
    call setwinvar(winid, '&scrolloff', 0)
  endif
  call setwinvar(winid, '&list', 0)
  call setwinvar(winid, '&number', 0)
  call setwinvar(winid, '&relativenumber', 0)
  call setwinvar(winid, '&cursorcolumn', 0)
  call setwinvar(winid, '&colorcolumn', 0)
  call setwinvar(winid, 'float', 1)
  call setwinvar(winid, '&wrap', 1)
  call setwinvar(winid, '&linebreak', 1)
  call setwinvar(winid, '&conceallevel', 2)
  let g:coc_last_float_win = winid
  call coc#util#do_autocmd('CocOpenFloat')
  return [winid, winbufnr(winid)]
endfunction

function! coc#float#valid(winid) abort
  if a:winid == 0 || type(a:winid) != 0
    return 0
  endif
  if s:is_vim
    return s:popup_visible(a:winid)
  endif
  if exists('*nvim_win_is_valid') && nvim_win_is_valid(a:winid)
    let config = nvim_win_get_config(a:winid)
    return !empty(get(config, 'relative', ''))
  endif
  return 0
endfunction

" create buffer for popup/float window
function! coc#float#create_float_buf(bufnr) abort
  " reuse buffer cause error on vim8
  if a:bufnr && bufloaded(a:bufnr)
    return a:bufnr
  endif
  if s:is_vim
    noa let bufnr = bufadd('')
    noa call bufload(bufnr)
  else
    noa let bufnr = nvim_create_buf(v:false, v:true)
  endif
  " Don't use popup filetype, it would crash on reuse!
  call setbufvar(bufnr, '&buftype', 'nofile')
  call setbufvar(bufnr, '&bufhidden', 'hide')
  call setbufvar(bufnr, '&swapfile', 0)
  call setbufvar(bufnr, '&tabstop', 2)
  call setbufvar(bufnr, '&undolevels', -1)
  return bufnr
endfunction

" border window for neovim, content config with border
function! coc#float#nvim_border_win(config, border, title, related) abort
  if empty(a:border)
    return
  endif
  " width height col row relative
  noa let bufnr = nvim_create_buf(v:false, v:true)
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  let row = a:border[0] ? a:config['row'] - 1 : a:config['row']
  let col = a:border[3] ? a:config['col'] - 1 : a:config['col']
  let width = a:config['width'] + a:border[1] + a:border[3]
  let height = a:config['height'] + a:border[0] + a:border[2]
  let opt = {
        \ 'relative': a:config['relative'],
        \ 'width': width,
        \ 'height': height,
        \ 'row': row,
        \ 'col': col,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  let winid = nvim_open_win(bufnr, 0, opt)
  if !winid
    return
  endif
  call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
  let lines = coc#float#create_border_lines(a:border, a:title, a:config['width'], a:config['height'])
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
  call add(a:related, winid)
endfunction

function! coc#float#create_border_lines(border, title, width, height) abort
  let list = []
  if a:border[0]
    let top = (a:border[3] ?  s:borderchars[4]: '')
          \.repeat(s:borderchars[0], a:width)
          \.(a:border[1] ? s:borderchars[5] : '')
    if !empty(a:title)
      let top = coc#helper#str_compose(top, 1, a:title.' ')
    endif
    call add(list, top)
  endif
  let mid = (a:border[3] ?  s:borderchars[3]: '')
        \.repeat(' ', a:width)
        \.(a:border[1] ? s:borderchars[1] : '')
  call extend(list, repeat([mid], a:height))
  if a:border[2]
    let bot = (a:border[3] ?  s:borderchars[7]: '')
          \.repeat(s:borderchars[2], a:width)
          \.(a:border[1] ? s:borderchars[6] : '')
    call add(list, bot)
  endif
  return list
endfunction

" Create float window for input
function! coc#float#create_prompt_win(title, default) abort
  call coc#float#close_auto_hide_wins()
  noa let bufnr = nvim_create_buf(v:false, v:true)
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, [a:default])
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  " Calculate col
  let curr = win_screenpos(winnr())[1] + wincol() - 2
  let width = min([max([strdisplaywidth(a:title) + 2, s:prompt_win_width]), &columns - 2])
  if width == &columns - 2
    let col = 0 - curr
  else
    let col = curr + width <= &columns - 2 ? 0 : &columns - s:prompt_win_width
  endif
  let config = {
        \ 'relative': 'cursor',
        \ 'width': width,
        \ 'height': 1,
        \ 'row': 0,
        \ 'col': col,
        \ 'style': 'minimal',
        \ }
  let winid = nvim_open_win(bufnr, 0, config)
  if winid == 0
    return []
  endif
  call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
  let related = []
  call coc#float#nvim_border_win(config, [1,1,1,1], a:title, related)
  call setwinvar(winid, 'related', related)
  call win_gotoid(winid)
  inoremap <buffer> <C-a> <Home>
  inoremap <buffer><expr><C-e> pumvisible() ? "\<C-e>" : "\<End>"
  exe 'inoremap <silent><buffer> <esc> <C-r>=coc#float#close_i('.winid.')<CR><esc>'
  exe 'nnoremap <silent><buffer> <esc> :call coc#float#close('.winid.')<CR>'
  exe 'inoremap <expr><nowait><buffer> <cr> "\<c-r>=coc#float#prompt_insert('.winid.')\<cr>\<esc>"'
  call feedkeys('A', 'in')
  return [bufnr, winid]
endfunction

function! coc#float#close_i(winid) abort
  call coc#float#close(a:winid)
  return ''
endfunction

function! coc#float#prompt_insert(winid) abort
  let text = getline('.')
  let bufnr = winbufnr(a:winid)
  call coc#rpc#notify('PromptInsert',[text, bufnr])
  call timer_start(50, { -> coc#float#close(a:winid)})
  return ''
endfunction

" Position of cursor relative to editor
function! s:win_position() abort
  let nr = winnr()
  let [row, col] = win_screenpos(nr)
  return [row + winline() - 2, col + wincol() - 2]
endfunction

" get popup position for vim8 based on config of neovim float window
function! s:popup_position(config) abort
  let relative = get(a:config, 'relative', 'editor')
  if relative ==# 'cursor'
    return [s:popup_cursor(a:config['row']), s:popup_cursor(a:config['col'])]
  endif
  return [a:config['row'] + 1, a:config['col'] + 1]
endfunction

function! s:popup_cursor(n) abort
  if a:n == 0
    return 'cursor'
  endif
  if a:n < 0
    return 'cursor'.a:n
  endif
  return 'cursor+'.a:n
endfunction

" Close float window by id
function! coc#float#close(winid) abort
  if !coc#float#valid(a:winid)
    return 0
  endif
  if s:is_vim
    call popup_close(a:winid)
    return 1
  else
    call coc#float#nvim_close_related(a:winid)
    call nvim_win_close(a:winid, 1)
    return 1
  endif
  return 0
endfunction

" Float window id on current tab.
" return 0 if not found
function! coc#float#get_float_win() abort
  if has('nvim')
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      if (!empty(config) && config['focusable'] == v:true && !empty(config['relative']))
        if !getwinvar(id, 'button', 0)
          return id
        endif
      endif
    endfor
  elseif exists('*popup_list')
    let arr = filter(popup_list(), 'popup_getpos(v:val)["visible"]')
    if !empty(arr)
      return arr[0]
    endif
  endif
  return 0
endfunction

function! coc#float#get_float_win_list() abort
  if s:is_vim && exists('*popup_list')
    return filter(popup_list(), 'popup_getpos(v:val)["visible"]')
  elseif has('nvim') && exists('*nvim_win_get_config')
    let res = []
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      " ignore border & button window
      if (!empty(config) && config['focusable'] == v:true && !empty(config['relative']))
        if !getwinvar(id, 'button', 0)
          call add(res, id)
        endif
      endif
    endfor
    return res
  endif
  return []
endfunction

" Check if a float window is scrollable
function! coc#float#scrollable(winid) abort
  let bufnr = winbufnr(a:winid)
  if bufnr == -1
    return 0
  endif
  if s:is_vim
    let pos = popup_getpos(a:winid)
    " scrollbar enabled
    if get(popup_getoptions(a:winid), 'scrollbar', 0)
      return get(pos, 'scrollbar', 0)
    endif
    let ch = coc#float#content_height(bufnr, pos['core_width'], getwinvar(a:winid, '&wrap'))
    return ch > pos['core_height']
  else
    let height = nvim_win_get_height(a:winid)
    let width = nvim_win_get_width(a:winid)
    if width > 1 && getwinvar(a:winid, '&foldcolumn', 0)
      " since we use foldcolumn for left pading
      let width = width - 1
    endif
    let ch = coc#float#content_height(bufnr, width, getwinvar(a:winid, '&wrap'))
    return ch > height
  endif
endfunction

function! coc#float#has_scroll() abort
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  return !empty(win_ids)
endfunction

function! coc#float#scroll(forward, ...)
  if !has('nvim-0.4.3') && !has('patch-8.2.0750')
    throw 'coc#float#scroll() requires nvim >= 0.4.3 or vim >= 8.2.0750'
  endif
  let amount = get(a:, 1, 0)
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  if empty(win_ids)
    return ''
  endif
  if has('nvim')
    call timer_start(10, { -> s:scroll_nvim(win_ids, a:forward, amount)})
  else
    call timer_start(10, { -> s:scroll_vim(win_ids, a:forward, amount)})
  endif
  return mode() =~ '^i' ? "" : "\<Ignore>"
endfunction

function! s:scroll_nvim(win_ids, forward, amount) abort
  let curr = win_getid()
  for id in a:win_ids
    if nvim_win_is_valid(id)
      let wrapped = 0
      let width = nvim_win_get_width(id)
      if getwinvar(id, '&wrap', 0)
        if width > 1 && getwinvar(id, '&foldcolumn', 0)
          let width = width - 1
        endif
        for line in nvim_buf_get_lines(winbufnr(id), 0, -1, v:false)
          if strdisplaywidth(line) > width
            let wrapped = 1
            break
          endif
        endfor
      endif
      noa call win_gotoid(id)
      let height = nvim_win_get_height(id)
      let firstline = line('w0')
      let lastline = line('w$')
      let linecount = line('$')
      let delta = a:amount ? a:amount : max([1, height - 1])
      if a:forward
        if lastline == linecount && strdisplaywidth(line('$')) <= width
          continue
        endif
        if !a:amount && firstline != lastline
          execute 'noa normal! Lzt'
        else
          execute 'noa normal! H'.delta.'jzt'
        endif
        let lnum = line('.')
        while lnum < linecount && line('w0') == firstline && line('w$') == lastline
          execute 'noa normal! jzt'
          let lnum = lnum + 1
        endwhile
      else
        if !a:amount && firstline != lastline
          execute 'noa normal! Hzb'
        else
          execute 'noa normal! L'.delta.'kzb'
        endif
        let lnum = line('.')
        while lnum > 1 && line('w0') == firstline && line('w$') == lastline
          execute 'noa normal! kzb'
          let lnum = lnum - 1
        endwhile
      endif
      call coc#float#nvim_scrollbar(id)
    endif
  endfor
  noa call win_gotoid(curr)
  redraw
endfunction

function! s:scroll_vim(win_ids, forward, amount) abort
  for id in a:win_ids
    if s:popup_visible(id)
      let pos = popup_getpos(id)
      let bufnr = winbufnr(id)
      let linecount = get(getbufinfo(bufnr)[0], 'linecount', 0)
      " for forward use last line (or last line + 1) as first line
      if a:forward
        if pos['firstline'] == pos['lastline']
          call popup_setoptions(id, {'firstline': min([pos['firstline'] + 1, linecount])})
        else
          if pos['lastline'] == linecount
            let win_width = pos['core_width']
            let text = getbufline(bufnr, '$')[0]
            if strdisplaywidth(text) <= win_width
              " last line shown
              return
            endif
          endif
          let lnum = a:amount ? min([linecount, pos['firstline'] + a:amount]) : pos['lastline']
          call popup_setoptions(id, {'firstline': lnum})
        endif
      else
        if pos['firstline'] == 1
          call win_execute(id, 'normal! gg0')
          return
        endif
        " we could only change firstline
        " iterate lines before last lines to fill content height - 1
        let total_height = a:amount ? min([a:amount, pos['core_height']]) : pos['core_height'] - 1
        if total_height == 0
          call popup_setoptions(id, {'firstline': pos['firstline'] - 1})
        else
          let lines = getbufline(bufnr, 1, '$')
          let curr = pos['firstline'] - 1
          let width = pos['core_width']
          let used = 0
          while v:true
            if curr == 1
              break
            endif
            let w = max([1, strdisplaywidth(lines[curr - 1])])
            let used += float2nr(ceil(str2float(string(w))/width))
            if used > total_height
              let curr = curr == pos['firstline'] -1 ? curr : curr + 1
              break
            elseif used == total_height
              break
            endif
            let curr = curr - 1
          endwhile
          call popup_setoptions(id, {'firstline': curr})
        endif
      endif
    endif
  endfor
  redraw
endfunction

function! s:popup_visible(id) abort
  let pos = popup_getpos(a:id)
  if !empty(pos) && get(pos, 'visible', 0)
    return 1
  endif
  return 0
endfunction

function! s:convert_config_nvim(config) abort
  let result = coc#helper#dict_omit(a:config, ['title', 'border', 'cursorline', 'autohide', 'close'])
  let border = get(a:config, 'border', [])
  if !empty(border)
    if result['relative'] ==# 'cursor' && result['row'] < 0
      " move top when has bottom border
      if get(border, 2, 0)
        let result['row'] = result['row'] - 1
      endif
    else
      " move down when has top border
      if get(border, 0, 0)
        let result['row'] = result['row'] + 1
      endif
    endif
    " move right when has left border
    if get(border, 3, 0)
      let result['col'] = result['col'] + 1
    endif
    let result['width'] = result['width'] - 1 - get(border,3, 0)
  else
    let result['width'] = result['width'] - 1
  endif
  return result
endfunction

" Close windows that could auto hide
function! coc#float#close_auto_hide_wins(...) abort
  let winids = coc#float#get_float_win_list()
  let except = get(a:, 1, 0)
  for id in winids
    if except && id == except
      continue
    endif
    if getwinvar(id, 'autohide', 0)
      call coc#float#close(id)
    endif
  endfor
endfunction

" neovim only
function! coc#float#nvim_close_btn(config, winid, close, border, related) abort
  if !a:close
    return
  endif
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': 1,
        \ 'row': get(a:border, 0, 0) ? a:config['row'] - 1 : a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:true,
        \ 'style': 'minimal',
        \ }
  noa let bufnr = nvim_create_buf(v:false, v:true)
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, ['X'])
  let winid = nvim_open_win(bufnr, 0, config)
  " map for winid & close_winid
  if winid
    call setwinvar(winid, 'button', 1)
    call setwinvar(a:winid, 'close_winid', winid)
    call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
    call add(a:related, winid)
  endif
endfunction

function! coc#float#nvim_check_close(winid) abort
  let target = getwinvar(a:winid, 'target_winid', 0)
  if target
    call coc#float#close(target)
  endif
endfunction

" Create padding window by config of current window & border config
function! coc#float#nvim_right_pad(config, border, related) abort
  " Check right border
  if !empty(a:border) && get(a:border, 1, 0)
    return
  endif
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': a:config['height'],
        \ 'row': a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  noa let bufnr = nvim_create_buf(v:false, v:true)
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, repeat([' '], a:config['height']))
  let winid = nvim_open_win(bufnr, 0, config)
  if winid
    call setwinvar(winid, 'ispad', 1)
    call setwinvar(winid, '&winhl', 'Normal:CocFloating,NormalNC:CocFloating')
    call add(a:related, winid)
  endif
endfunction

function! coc#float#content_height(bufnr, width, wrap) abort
  if !bufloaded(a:bufnr)
    return 0
  endif
  if !a:wrap
    return has('nvim') ? nvim_buf_line_count(a:bufnr) : len(getbufline(a:bufnr, 1, '$'))
  endif
  let lines = has('nvim') ? nvim_buf_get_lines(a:bufnr, 0, -1, 0) : getbufline(a:bufnr, 1, '$')
  let total = 0
  for line in lines
    let dw = max([1, strdisplaywidth(line)])
    let total += float2nr(ceil(str2float(string(dw))/a:width))
  endfor
  return total
endfunction

function! s:add_related(winid, target) abort
  let arr = getwinvar(a:target, 'related', [])
  if index(arr, a:winid) >= 0
    return
  endif
  call add(arr, a:winid)
  call setwinvar(a:target, 'related', arr)
endfunction

function! coc#float#nvim_refresh_scrollbar() abort
  let id = getwinvar(win_getid(), 'scrollbar', 0)
  if coc#float#valid(id)
    call coc#float#nvim_scrollbar(win_getid())
  endif
endfunction

" Close related windows for neovim.
function! coc#float#nvim_close_related(winid) abort
  if !has('nvim') || !a:winid
    return
  endif
  let winids = getwinvar(a:winid, 'related', [])
  if !empty(winids)
    call nvim_win_del_var(a:winid, 'related')
  endif
  for id in winids
    if nvim_win_is_valid(id) && id != a:winid
      call nvim_win_close(id, 1)
    endif
  endfor
endfunction

function! coc#float#nvim_create_related(winid, config, opts) abort
  let related = []
  call coc#float#nvim_close_btn(a:config, a:winid, get(a:opts, 'close', 0), get(a:opts, 'border', []), related)
  call coc#float#nvim_border_win(a:config, get(a:opts, 'border', []), get(a:opts, 'title', ''), related)
  call coc#float#nvim_right_pad(a:config, get(a:opts, 'border', []), related)
  for id in related
    call setwinvar(id, 'target_winid', a:winid)
  endfor
  call setwinvar(a:winid, 'related', related)
endfunction

" Create scrollbar for winid
" Need called on create, config, buffer change, scrolled
function! coc#float#nvim_scrollbar(winid) abort
  if !has('nvim-0.4.3')
    return
  endif
  if a:winid == 0 || !nvim_win_is_valid(a:winid) || getwinvar(a:winid, 'button', 0)
    return
  endif
  let config = nvim_win_get_config(a:winid)
  " ignore border & button window
  if (!get(config, 'focusable', v:false) || empty(get(config, 'relative', '')))
    return
  endif
  let [row, column] = nvim_win_get_position(a:winid)
  let width = nvim_win_get_width(a:winid)
  let height = nvim_win_get_height(a:winid)
  let bufnr = winbufnr(a:winid)
  let cw = getwinvar(a:winid, '&foldcolumn', 0) ? width - 1 : width
  let ch = coc#float#content_height(bufnr, cw, getwinvar(a:winid, '&wrap'))
  let close_winid = getwinvar(a:winid, 'close_winid', 0)
  let border = getwinvar(a:winid, 'border', [])
  let move_down = close_winid && !get(border, 0, 0)
  if move_down
    let height = height - 1
    if height == 0
      return
    endif
  endif
  let id = 0
  if nvim_win_is_valid(getwinvar(a:winid, 'scrollbar', 0))
    let id = getwinvar(a:winid, 'scrollbar', 0)
  endif
  if ch <= height || height == 0
    " no scrollbar, remove exists
    if id
      call nvim_win_del_var(a:winid, 'scrollbar')
      call coc#float#close(id)
    endif
    return
  endif
  if height == 0
    return
  endif
  if id && bufloaded(winbufnr(id))
    let sbuf = winbufnr(id)
  else
    noa let sbuf = nvim_create_buf(v:false, v:true)
    call setbufvar(sbuf, '&bufhidden', 'wipe')
  endif
  call nvim_buf_set_lines(sbuf, 0, -1, v:false, repeat([' '], height))
  let opts = {
        \ 'row': move_down ? row + 1 : row,
        \ 'col': column + width,
        \ 'relative': 'editor',
        \ 'width': 1,
        \ 'height': height,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if id
    call nvim_win_set_config(id, opts)
  else
    let id = nvim_open_win(sbuf, 0 , opts)
    call setwinvar(id, 'isscrollbar', 1)
    call setwinvar(id, 'target_winid', a:winid)
  endif
  let thumb_height = max([1, float2nr(floor(height * (height + 0.0)/ch))])
  let curr = win_getid()
  if curr != a:winid
    noa call win_gotoid(a:winid)
  endif
  let firstline = line('w0')
  let lastline = line('w$')
  let linecount = line('$')
  if firstline == 1
    let start = 0
  elseif lastline == linecount
    let start = height - thumb_height
  else
    let start = max([1, float2nr(round((height - thumb_height + 0.0)*(firstline - 1.0)/(ch - height)))])
  endif
  if curr != a:winid
    noa call win_gotoid(curr)
  endif
  " add highlights
  call nvim_buf_clear_namespace(sbuf, s:scrollbar_ns, 0, -1)
  for idx in range(0, height - 1)
    if idx >= start && idx < start + thumb_height
      call nvim_buf_add_highlight(sbuf, s:scrollbar_ns, 'PmenuThumb', idx, 0, 1)
    else
      call nvim_buf_add_highlight(sbuf, s:scrollbar_ns, 'PmenuSbar', idx, 0, 1)
    endif
  endfor
  " create scrollbar outside window
  call setwinvar(a:winid, 'scrollbar', id)
  call s:add_related(id, a:winid)
endfunction

function! coc#float#nvim_check_related() abort
  if !has('nvim')
    return
  endif
  let invalids = []
  for i in range(1, winnr('$'))
    let id = win_getid(i)
    let target = getwinvar(id, 'target_winid', 0)
    if target && !nvim_win_is_valid(target)
      call add(invalids, id)
    endif
  endfor
  for id in invalids
    noa call nvim_win_close(id, 1)
  endfor
endfunction

" Dimension of window with lines relative to cursor
function! coc#float#calculate_dimension(lines, config) abort
  let preferTop = get(a:config, 'preferTop', 0)
  let vh = &lines - &cmdheight - 1
  if vh <= 0
    return v:null
  endif
  let maxWidth = min([get(a:config, 'maxWidth', 80), &columns - 1])
  if maxWidth < 3
    return v:null
  endif
  let maxHeight = min([get(a:config, 'maxHeight', 80), vh])
  let ch = 0
  let width = 0
  for line in a:lines
    let dw = max([1, strdisplaywidth(line)])
    let width = max([width, dw + 2])
    let ch += float2nr(ceil(str2float(string(dw))/(maxWidth - 2)))
  endfor
  let width = min([maxWidth, width])
  " How much we should move left
  let [lineIdx, colIdx] = s:win_position()
  let offsetX = min([get(a:config, 'offsetX', 0), colIdx])
  let showTop = 0
  let hb = vh - lineIdx -1
  if lineIdx > 2 && (preferTop || (lineIdx > hb && hb < ch))
    let showTop = 1
  endif
  let height =  min([ch, showTop ? lineIdx - 1 : hb])
  let col = - max([offsetX, colIdx - (&columns - 1 - width)])
  let row = showTop ? - height : 1
  return {
        \ 'row': row,
        \ 'col': col,
        \ 'width': width,
        \ 'height': height
        \ }
endfunction
