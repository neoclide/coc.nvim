scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:pum_bufnr = 0
let s:pum_winid = -1
let s:pum_index = -1
let s:pum_size = 0
" word of complete item inserted
let s:inserted = 0
let s:virtual_text = 0
let s:virtual_text_ns = coc#highlight#create_namespace('pum-virtual')
" bufnr, &indentkeys
let s:saved_indenetkeys = []
let s:saved_textwidth = []
let s:prop_id = 0
let s:reversed = 0
let s:check_hl_group = 0
let s:start_col = -1

if s:is_vim
  if empty(prop_type_get('CocPumVirtualText'))
    call prop_type_add('CocPumVirtualText', {'highlight': 'CocPumVirtualText'})
  endif
endif

function! coc#pum#has_item_selected() abort
    return coc#pum#visible() && s:pum_index != -1
endfunction

function! coc#pum#visible() abort
  if s:pum_winid == -1
    return 0
  endif
  " getwinvar check current tab only.
  return getwinvar(s:pum_winid, 'float', 0) == 1
endfunction

function! coc#pum#winid() abort
  return s:pum_winid
endfunction

function! coc#pum#close_detail() abort
  let winid = coc#float#get_float_by_kind('pumdetail')
  if winid
    call coc#float#close(winid, 1)
  endif
endfunction

" kind, and skipRequest (default to false)
function! coc#pum#close(...) abort
  if coc#pum#visible()
    let inserted = 0
    let kind = get(a:, 1, '')
    if kind ==# 'cancel'
      let input = getwinvar(s:pum_winid, 'input', '')
      let s:pum_index = -1
      let inserted = s:insert_word(input, 1)
      call s:on_pum_change(0)
    elseif kind ==# 'confirm'
      let words = getwinvar(s:pum_winid, 'words', [])
      if s:pum_index >= 0
        let word = get(words, s:pum_index, '')
        let inserted = s:insert_word(word, 1)
        " have to restore here, so that TextChangedI can trigger indent.
        call s:restore_indentkeys()
      endif
    endif
    call s:close_pum()
    if !get(a:, 2, 0)
      " Needed to wait TextChangedI fired
      if inserted
        call timer_start(0, {-> coc#rpc#request('stopCompletion', [kind])})
      else
        call coc#rpc#request('stopCompletion', [kind])
      endif
    endif
  endif
  return ''
endfunction

function! coc#pum#select_confirm() abort
  if coc#pum#visible()
    if s:pum_index < 0
      let s:pum_index = 0
      call s:on_pum_change(0)
    endif
    " Avoid change of text not allowed
    return "\<C-r>=coc#pum#close('confirm')\<CR>"
  endif
  return ''
endfunction

function! coc#pum#_close() abort
  if coc#pum#visible()
    call s:close_pum()
    if s:is_vim
      call timer_start(0, {-> execute('redraw')})
    endif
  endif
endfunction

function! coc#pum#_one_more() abort
  if coc#pum#visible()
    let parts = getwinvar(s:pum_winid, 'parts', [])
    let start = strlen(parts[0])
    let input = strpart(getline('.'), start, col('.') - 1 - start)
    let words = getwinvar(s:pum_winid, 'words', [])
    let word = get(words, s:pum_index == -1 ? 0 : s:pum_index, '')
    if !empty(word) && strcharpart(word, 0, strchars(input)) ==# input
      let ch = strcharpart(word, strchars(input), 1)
      if !empty(ch)
        call feedkeys(ch, "nt")
      endif
    endif
  endif
  return ''
endfunction

function! coc#pum#_insert() abort
  if coc#pum#visible()
    if s:pum_index >= 0
      let words = getwinvar(s:pum_winid, 'words', [])
      let word = get(words, s:pum_index, '')
      call s:insert_word(word, 1)
      call s:restore_indentkeys()
    endif
    doautocmd <nomodeline> TextChangedI
    call s:close_pum()
    call timer_start(0, {-> coc#rpc#request('stopCompletion', [''])})
  endif
  return ''
endfunction

function! coc#pum#insert() abort
  return "\<C-r>=coc#pum#_insert()\<CR>"
endfunction

" Add one more character from the matched complete item(or first one),
" the word should starts with input, the same as vim's CTRL-L behavior.
function! coc#pum#one_more() abort
  return "\<C-r>=coc#pum#_one_more()\<CR>"
endfunction

function! coc#pum#next(insert) abort
  return "\<C-r>=coc#pum#_navigate(1,".a:insert.")\<CR>"
endfunction

function! coc#pum#prev(insert) abort
  return "\<C-r>=coc#pum#_navigate(0,".a:insert.")\<CR>"
endfunction

function! coc#pum#stop() abort
  return "\<C-r>=coc#pum#close()\<CR>"
endfunction

function! coc#pum#cancel() abort
  return "\<C-r>=coc#pum#close('cancel')\<CR>"
endfunction

function! coc#pum#confirm() abort
  return "\<C-r>=coc#pum#close('confirm')\<CR>"
endfunction

function! coc#pum#select(index, insert, confirm) abort
  if coc#pum#visible()
    if a:index == -1
      call coc#pum#close('cancel')
      return ''
    endif
    if a:index < 0 || a:index >= s:pum_size
      throw 'index out of range ' . a:index
    endif
    if a:confirm
      if s:pum_index != a:index
        let s:pum_index = a:index
        let s:inserted = 1
        call s:on_pum_change(0)
      endif
      call coc#pum#close('confirm')
    else
      call s:select_by_index(a:index, a:insert)
    endif
  endif
  return ''
endfunction

function! coc#pum#info() abort
  let bufnr = winbufnr(s:pum_winid)
  let words = getwinvar(s:pum_winid, 'words', [])
  let word = s:pum_index < 0 ? '' : get(words, s:pum_index, '')
  let base = {
        \ 'word': word,
        \ 'index': s:pum_index,
        \ 'size': s:pum_size,
        \ 'startcol': s:start_col,
        \ 'inserted': s:pum_index >=0 && s:inserted ? v:true : v:false,
        \ 'reversed': s:reversed ? v:true : v:false,
        \ }
  if s:is_vim
    let pos = popup_getpos(s:pum_winid)
    let border = has_key(popup_getoptions(s:pum_winid), 'border')
    let add = pos['scrollbar'] && border ? 1 : 0
    return extend(base, {
          \ 'scrollbar': pos['scrollbar'],
          \ 'row': pos['line'] - 1,
          \ 'col': pos['col'] - 1,
          \ 'width': pos['width'] + add,
          \ 'height': pos['height'],
          \ 'border': border,
          \ })
  else
    let scrollbar = coc#float#get_related(s:pum_winid, 'scrollbar')
    let winid = coc#float#get_related(s:pum_winid, 'border', s:pum_winid)
    let pos = nvim_win_get_position(winid)
    return extend(base, {
          \ 'scrollbar': scrollbar && nvim_win_is_valid(scrollbar) ? 1 : 0,
          \ 'row': pos[0],
          \ 'col': pos[1],
          \ 'width': nvim_win_get_width(winid),
          \ 'height': nvim_win_get_height(winid),
          \ 'border': winid != s:pum_winid,
          \ })
  endif
endfunction

function! coc#pum#scroll(forward) abort
  if coc#pum#visible()
    let height = s:get_height(s:pum_winid)
    if s:pum_size > height
      call timer_start(1, { -> s:scroll_pum(a:forward, height, s:pum_size)})
    endif
  endif
  " Required on old version vim/neovim.
  return "\<Ignore>"
endfunction

function! s:get_height(winid) abort
  if s:is_vim
    return get(popup_getpos(a:winid), 'core_height', 0)
  endif
  return nvim_win_get_height(a:winid)
endfunction

function! s:scroll_pum(forward, height, size) abort
  let topline = s:get_topline(s:pum_winid)
  if !a:forward && topline == 1
    if s:pum_index >= 0
      call s:select_line(s:pum_winid, 1)
      call s:on_pum_change(1)
    endif
    return
  endif
  if a:forward && topline + a:height - 1 >= a:size
    if s:pum_index >= 0
      call s:select_line(s:pum_winid, a:size)
      call s:on_pum_change(1)
    endif
    return
  endif
  call coc#float#scroll_win(s:pum_winid, a:forward, a:height)
  if s:pum_index >= 0
    let lnum = s:pum_index + 1
    let topline = s:get_topline(s:pum_winid)
    if lnum >= topline && lnum <= topline + a:height - 1
      return
    endif
    call s:select_line(s:pum_winid, topline)
    call s:on_pum_change(1)
  endif
endfunction

function! s:get_topline(winid) abort
  if s:is_vim
    let pos = popup_getpos(a:winid)
    return pos['firstline']
  endif
  let info = getwininfo(a:winid)[0]
  return info['topline']
endfunction

function! coc#pum#_navigate(next, insert) abort
  if coc#pum#visible()
    call s:save_indentkeys()
    let index = s:get_index(a:next)
    call s:select_by_index(index, a:insert)
    call coc#rpc#notify('PumNavigate', [bufnr('%')])
  endif
  return ''
endfunction

function! s:select_by_index(index, insert) abort
  let lnum = a:index == -1 ? 0 : s:index_to_lnum(a:index)
  call s:set_cursor(s:pum_winid, lnum)
  if !s:is_vim
    call coc#float#nvim_scrollbar(s:pum_winid)
  endif
  if a:insert
    let s:inserted = a:index >= 0
    if a:index < 0
      let input = getwinvar(s:pum_winid, 'input', '')
      call s:insert_word(input, 0)
      call coc#pum#close_detail()
    else
      let words = getwinvar(s:pum_winid, 'words', [])
      let word = get(words, a:index, '')
      call s:insert_word(word, 0)
    endif
  endif
  call s:on_pum_change(1)
endfunction

function! s:get_index(next) abort
  if a:next
    let index = s:pum_index + 1 == s:pum_size ? -1 : s:pum_index + 1
  else
    let index = s:pum_index == -1 ? s:pum_size - 1 : s:pum_index - 1
  endif
  return index
endfunction

function! s:insert_word(word, finish) abort
  if s:start_col != -1 && mode() ==# 'i'
    " Not insert same characters
    let inserted = strpart(getline('.'), s:start_col, col('.') - 1)
    if inserted !=# a:word
      " avoid auto wrap using 'textwidth'
      if !a:finish && &textwidth > 0
        let textwidth = &textwidth
        noa setl textwidth=0
        call timer_start(0, { -> execute('noa setl textwidth='.textwidth)})
      endif
      let saved_completeopt = &completeopt
      noa set completeopt=noinsert,noselect
      noa call complete(s:start_col + 1, [{ 'empty': v:true, 'word': a:word }])
      noa call feedkeys("\<C-n>\<C-x>\<C-z>", 'in')
      call timer_start(0, { -> execute('noa set completeopt='.saved_completeopt)})
      return 1
    endif
  endif
  return 0
endfunction

" Replace from col to cursor col with new characters
function! coc#pum#replace(col, insert, delta) abort
  if a:delta == 1
    call feedkeys("\<right>", 'in')
  endif
  let saved_completeopt = &completeopt
  noa set completeopt=noinsert,noselect
  noa call complete(a:col, [{ 'empty': v:true, 'word': a:insert }])
  noa call feedkeys("\<C-n>\<C-x>\<C-z>", 'n')
execute 'noa set completeopt='.saved_completeopt
endfunction

" create or update pum with lines, CompleteOption and config.
" return winid & dimension
function! coc#pum#create(lines, opt, config) abort
  if mode() !=# 'i' || a:opt['line'] != line('.')
    return
  endif
  let len = col('.') - a:opt['col'] - 1
  if len < 0
    return
  endif
  let input = len == 0 ? '' : strpart(getline('.'), a:opt['col'], len)
  if input !=# a:opt['input']
    return
  endif
  let config = s:get_pum_dimension(a:lines, a:opt['col'], a:config)
  if empty(config)
    return
  endif
  let s:reversed = get(a:config, 'reverse', 0) && config['row'] < 0
  let s:virtual_text = get(a:opt, 'virtualText', v:false)
  let s:pum_size = len(a:lines)
  let s:pum_index = a:opt['index']
  let lnum = s:index_to_lnum(s:pum_index)
  call extend(config, {
        \ 'lines': s:reversed ? reverse(copy(a:lines)) : a:lines,
        \ 'relative': 'cursor',
        \ 'nopad': 1,
        \ 'cursorline': 1,
        \ 'index': lnum - 1,
        \ 'focusable': v:false
        \ })
  call extend(config, coc#dict#pick(a:config, ['highlight', 'rounded', 'highlights', 'winblend', 'shadow', 'border', 'borderhighlight', 'title']))
  if s:reversed
    for item in config['highlights']
      let item['lnum'] = s:pum_size - item['lnum'] - 1
    endfor
  endif
  if empty(get(config, 'winblend', 0)) && exists('&pumblend')
    let config['winblend'] = &pumblend
  endif
  let result =  coc#float#create_float_win(s:pum_winid, s:pum_bufnr, config)
  if empty(result)
    return
  endif
  let s:inserted = 0
  let s:pum_winid = result[0]
  let s:pum_bufnr = result[1]
  let s:start_col = a:opt['startcol']
  call setwinvar(s:pum_winid, 'above', config['row'] < 0)
  let firstline = s:get_firstline(lnum, s:pum_size, config['height'])
  if s:is_vim
    call popup_setoptions(s:pum_winid, { 'firstline': firstline })
  else
    call win_execute(s:pum_winid, 'call winrestview({"lnum":'.lnum.',"topline":'.firstline.'})')
  endif
  call coc#dialog#place_sign(s:pum_bufnr, s:pum_index == -1 ? 0 : lnum)
  " content before col and content after cursor
  let linetext = getline('.')
  let parts = [strpart(linetext, 0, s:start_col), strpart(linetext, col('.') - 1)]
  let input = strpart(getline('.'), s:start_col, col('.') - 1 - s:start_col)
  call setwinvar(s:pum_winid, 'input', input)
  call setwinvar(s:pum_winid, 'parts', parts)
  call setwinvar(s:pum_winid, 'words', a:opt['words'])
  call setwinvar(s:pum_winid, 'kind', 'pum')
  if !s:is_vim
    if s:pum_size > config['height']
      call timer_start(0,{ -> coc#float#nvim_scrollbar(s:pum_winid)})
    else
      call coc#float#close_related(s:pum_winid, 'scrollbar')
    endif
  endif
  call s:on_pum_change(0)
endfunction

function! s:save_indentkeys() abort
  let bufnr = bufnr('%')
  if !empty(&indentexpr) && get(s:saved_indenetkeys, 0, 0) != bufnr
    let s:saved_indenetkeys = [bufnr, &indentkeys]
    execute 'setl indentkeys='
  endif
endfunction

function! s:get_firstline(lnum, total, height) abort
  if a:lnum <= a:height
    return 1
  endif
  return min([a:total - a:height + 1, a:lnum  - (a:height*2/3)])
endfunction

function! s:on_pum_change(move) abort
  if s:virtual_text
    if s:inserted
      call coc#pum#clear_vtext()
    else
      call s:insert_virtual_text()
    endif
  endif
  let ev = extend(coc#pum#info(), {'move': a:move ? v:true : v:false})
  call coc#rpc#notify('CocAutocmd', ['MenuPopupChanged', ev, win_screenpos(winnr())[0] + winline() - 2])
endfunction

function! s:index_to_lnum(index) abort
  if s:reversed
    if a:index <= 0
      return s:pum_size
    endif
    return s:pum_size - a:index
  endif
  return max([1, a:index + 1])
endfunction

function! s:get_pum_dimension(lines, col, config) abort
  let linecount = len(a:lines)
  let [lineIdx, colIdx] = coc#cursor#screen_pos()
  let bh = empty(get(a:config, 'border', [])) ? 0 : 2
  let columns = &columns
  let pumwidth = max([15, exists('&pumwidth') ? &pumwidth : 0])
  let width = min([columns, max([pumwidth, a:config['width']])])
  let vh = &lines - &cmdheight - 1 - !empty(&tabline)
  if vh <= 0
    return v:null
  endif
  let pumheight = empty(&pumheight) ? vh : &pumheight
  let showTop = getwinvar(s:pum_winid, 'above', v:null)
  if type(showTop) != v:t_number
    if vh - lineIdx - bh - 1 < min([pumheight, linecount]) && vh - lineIdx < min([10, vh/2])
      let showTop = 1
    else
      let showTop = 0
    endif
  endif
  let height = showTop ? min([lineIdx - bh - !empty(&tabline), linecount, pumheight]) : min([vh - lineIdx - bh - 1, linecount, pumheight])
  if height <= 0
    return v:null
  endif
  " should use strdiplaywidth here
  let text = strpart(getline('.'), a:col, col('.') - 1 - a:col)
  let col = - strdisplaywidth(text, a:col) - 1
  let row = showTop ? - height : 1
  let delta = colIdx + col
  if width > pumwidth && delta + width > columns
    let width = max([columns - delta, pumwidth])
  endif
  if delta < 0
    let col = col - delta
  elseif delta + width > columns
    let col = max([-colIdx, col - (delta + width - columns)])
  endif
  return {
        \ 'row': row,
        \ 'col': col,
        \ 'width': width,
        \ 'height': height
        \ }
endfunction

" can't use coc#dialog#set_cursor on vim8, don't know why
function! s:set_cursor(winid, line) abort
  if s:is_vim
    let pos = popup_getpos(a:winid)
    let core_height = pos['core_height']
    let lastline = pos['firstline'] + core_height - 1
    if a:line > lastline
      call popup_setoptions(a:winid, {
            \ 'firstline': pos['firstline'] + a:line - lastline,
            \ })
    elseif a:line < pos['firstline']
      if s:reversed
        call popup_setoptions(a:winid, {
              \ 'firstline': a:line == 0 ? s:pum_size - core_height + 1 : a:line - core_height + 1,
              \ })
      else
        call popup_setoptions(a:winid, {
              \ 'firstline': max([1, a:line]),
              \ })
      endif
    endif
  endif
  call s:select_line(a:winid, a:line)
endfunction

function! s:select_line(winid, line) abort
  let s:pum_index = s:reversed ? (a:line == 0 ? -1 : s:pum_size - a:line) : a:line - 1
  let lnum = s:reversed ? (a:line == 0 ? s:pum_size : a:line) : max([1, a:line])
  if s:is_vim
    call win_execute(a:winid, 'exe '.lnum)
  else
    call nvim_win_set_cursor(a:winid, [lnum, 0])
  endif
  call coc#dialog#place_sign(s:pum_bufnr, a:line == 0 ? 0 : lnum)
endfunction

function! s:insert_virtual_text() abort
  let bufnr = bufnr('%')
  if !s:virtual_text || s:pum_index < 0
    call coc#pum#clear_vtext()
  else
    " Check if could create
    let insert = ''
    let line = line('.') - 1
    let words = getwinvar(s:pum_winid, 'words', [])
    let word = get(words, s:pum_index, '')
    let input = strpart(getline('.'), s:start_col, col('.') - 1 - s:start_col)
    if strlen(word) > strlen(input) && strcharpart(word, 0, strchars(input)) ==# input
      let insert = strcharpart(word, strchars(input))
    endif
    if s:is_vim
      if s:prop_id != 0
        call prop_remove({'id': s:prop_id}, line + 1, line + 1)
      endif
      if !empty(insert)
        let s:prop_id = prop_add(line + 1, col('.'), {
            \ 'text': insert,
            \ 'type': 'CocPumVirtualText'
            \ })
      endif
    else
      call nvim_buf_clear_namespace(bufnr, s:virtual_text_ns, line, line + 1)
      if !empty(insert)
        let opts = {
            \ 'hl_mode': 'combine',
            \ 'virt_text': [[insert, 'CocPumVirtualText']],
            \ 'virt_text_pos': 'overlay',
            \ 'virt_text_win_col': virtcol('.') - 1,
            \ }
        call nvim_buf_set_extmark(bufnr, s:virtual_text_ns, line, col('.') - 1, opts)
      endif
    endif
  endif
endfunction

function! coc#pum#clear_vtext() abort
  if s:is_vim
    if s:prop_id != 0
      call prop_remove({'id': s:prop_id})
    endif
    let s:prop_id = 0
  else
    call nvim_buf_clear_namespace(bufnr('%'), s:virtual_text_ns, 0, -1)
  endif
endfunction

function! s:close_pum() abort
  call coc#pum#clear_vtext()
  call coc#float#close(s:pum_winid, 1)
  let s:pum_winid = 0
  let s:pum_size = 0
  let winid = coc#float#get_float_by_kind('pumdetail')
  if winid
    call coc#float#close(winid, 1)
  endif
  call s:restore_indentkeys()
endfunction

function! s:restore_indentkeys() abort
  if get(s:saved_indenetkeys, 0, 0) == bufnr('%')
    call setbufvar(s:saved_indenetkeys[0], '&indentkeys', get(s:saved_indenetkeys, 1, ''))
    let s:saved_indenetkeys = []
  endif
endfunction
