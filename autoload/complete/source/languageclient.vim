
function! complete#source#languageclient#init()
  return {
        \'name': 'languageclient',
        \'shortcut': 'lc',
        \'priority': 9,
        \'filetypes': get(g:, 'complete_lcn_file_types', []),
        \}
endfunction

function! complete#source#languageclient#complete(opt, callback)
  let res = [{
        \ 'word': 'abcde'
        \}, {
        \ 'word': 'ffhhhali'
        \}]
  call call(a:callback, [res])
endfunction
