
function! necovim#get_complete_position(part)
  return 0
endfunction

function! necovim#gather_candidates(part, input)
  return [{
        \ 'word': 'neco',
        \}]
endfunction
