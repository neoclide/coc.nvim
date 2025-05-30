scriptencoding utf-8
let s:is_vim = !has('nvim')

let s:func_map = {
    \ 'del_markers': 'coc#vim9#Del_markers',
    \ 'buffer_update': 'coc#vim9#Buffer_update',
    \ 'update_highlights': 'coc#vim9#Update_highlights',
    \ 'set_highlights': 'coc#vim9#Set_highlights',
    \ 'clear_highlights': 'coc#vim9#Clear_highlights',
    \ 'add_highlight': 'coc#vim9#Add_highlight',
    \ 'clear_all': 'coc#vim9#Clear_all',
    \ 'highlight_ranges': 'coc#vim9#Highlight_ranges',
    \ }

function! s:call(name, args) abort
  try
    if s:is_vim
      call call(s:func_map[a:name], a:args)
    else
      call call(v:lua.require('coc.highlight')[a:name], a:args)
    endif
  catch /.*/
    " Need try catch here on vim9
    let name = s:is_vim ? get(s:func_map, a:name, a:name) : 'coc.highlight.' . a:name
    call coc#compat#send_error(name, s:is_vim)
  endtry
endfunction

" Update highlights of whole buffer, bufnr: number, key: any, highlights: list<any>, priority: number = 10, changedtick: any = null
function! coc#highlight#buffer_update(...) abort
  call s:call('buffer_update', a:000)
endfunction

" Update highlights, id: number, key: string, highlights: list<any>, start: number = 0, end: number = -1, priority: any = null
function! coc#highlight#update_highlights(...) abort
  call s:call('update_highlights', a:000)
endfunction

" Add multiple highlights, bufnr: number, key: any, highlights: list<any>, priority: number = 0
function! coc#highlight#set(...) abort
  call s:call('set_highlights', a:000)
endfunction

" bufnr: number, ids: list<number>
function! coc#highlight#del_markers(...) abort
  call s:call('del_markers', a:000)
endfunction

" id: number, key: any, start_line: number = 0, end_line: number = -1
function! coc#highlight#clear_highlight(...) abort
  call s:call('clear_highlights', a:000)
endfunction

" Add single highlight, id: number, src_id: number, hl_group: string, line: number, col_start: number, col_end: number, opts: dict<any> = {}
function! coc#highlight#add_highlight(...) abort
  call s:call('add_highlight', a:000)
endfunction

" Clear all extmark or textprop highlights of coc.nvim
function! coc#highlight#clear_all() abort
  call s:call('clear_all', [])
endfunction

" highlight LSP ranges. id: number, key: any, hlGroup: string, ranges: list<any>, opts: dict<any> = {}
function! coc#highlight#ranges(...) abort
  call s:call('highlight_ranges', a:000)
endfunction

" Get list of highlights, bufnr, key, [start, end] 0 based line index.
function! coc#highlight#get_highlights(bufnr, key, ...) abort
  if s:is_vim
    return coc#vim9#Get_highlights(a:bufnr, a:key, get(a:, 1, 0), get(a:, 2, -1))
  endif
  return v:lua.require('coc.highlight').get_highlights(a:bufnr, a:key, get(a:, 1, 0), get(a:, 2, -1))
endfunction

" highlight buffer in winid with CodeBlock and HighlightItems
" export interface HighlightItem {
"   lnum: number // 0 based
"   hlGroup: string
"   colStart: number // 0 based
"   colEnd: number
" }
" export interface CodeBlock {
"   filetype?: string
"   hlGroup?: string
"   startLine: number // 0 based
"   endLine: number
" }
function! coc#highlight#add_highlights(winid, codes, highlights) abort
  " clear highlights
  let bufnr = winbufnr(a:winid)
  let kind = getwinvar(a:winid, 'kind', '')
  if kind !=# 'pum'
    call win_execute(a:winid, 'syntax clear')
    if !empty(a:codes)
      call coc#highlight#highlight_lines(a:winid, a:codes)
    endif
  endif
  call coc#highlight#buffer_update(bufnr, -1, a:highlights)
endfunction

" Add highlights to line groups of winid, support hlGroup and filetype
" config should have startLine, endLine (0 based, end excluded) and filetype or hlGroup
" endLine should > startLine and endLine is excluded
function! coc#highlight#highlight_lines(winid, blocks) abort
  let region_id = 1
  let defined = []
  let cmds = []
  for config in a:blocks
    let start = config['startLine'] + 1
    let end = config['endLine'] == -1 ? len(getbufline(winbufnr(a:winid), 1, '$')) + 1 : config['endLine'] + 1
    let filetype = get(config, 'filetype', '')
    let hlGroup = get(config, 'hlGroup', '')
    if !empty(hlGroup)
      call add(cmds, 'syntax region '.hlGroup.' start=/\%'.start.'l/ end=/\%'.end.'l/')
    else
      let filetype = matchstr(filetype, '\v^\w+')
      if empty(filetype) || filetype == 'txt' || index(get(g:, 'coc_markdown_disabled_languages', []), filetype) != -1
        continue
      endif
      if index(defined, filetype) == -1
        call add(cmds, 'syntax include @'.toupper(filetype).' syntax/'.filetype.'.vim')
        call add(cmds, 'unlet! b:current_syntax')
        call add(defined, filetype)
      endif
      call add(cmds, 'syntax region CodeBlock'.region_id.' start=/\%'.start.'l/ end=/\%'.end.'l/ contains=@'.toupper(filetype).' keepend')
      let region_id = region_id + 1
    endif
  endfor
  if !empty(cmds)
    call win_execute(a:winid, cmds, 'silent!')
  endif
endfunction

" add matches for window. winid, bufnr, ranges, hlGroup, priority
function! coc#highlight#match_ranges(winid, bufnr, ranges, hlGroup, priority) abort
  if s:is_vim
    return coc#vim9#Match_ranges(a:winid, a:bufnr, a:ranges, a:hlGroup, a:priority)
  endif
  return v:lua.require('coc.highlight').match_ranges(a:winid, a:bufnr, a:ranges, a:hlGroup, a:priority)
endfunction

" Clear matches by hlGroup regexp, used by extension
function! coc#highlight#clear_match_group(winid, match) abort
  call coc#window#clear_match_group(a:winid, a:match)
endfunction

" Clear matches by match ids, use 0 for current win.
function! coc#highlight#clear_matches(winid, ids)
  call coc#window#clear_matches(a:winid, a:ids)
endfunction

function! coc#highlight#create_namespace(key) abort
  if type(a:key) == v:t_number
    return a:key
  endif
  return coc#compat#call('create_namespace', ['coc-'. a:key])
endfunction
