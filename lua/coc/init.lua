local M = {}

local function channel()
  if not vim.g.coc_channel_id or vim.g.coc_channel_id == 0 then
    return nil
  end
  return vim.g.coc_channel_id
end

local function rpc(method, ...)
  local ch = channel()
  if not ch then
    return nil
  end
  local ok, result = pcall(vim.rpcrequest, ch, method, ...)
  if not ok then
    return nil
  end
  return result
end

function M.get_diagnostics()
  return rpc('diagnosticList')
end

function M.get_config(section)
  return rpc('getConfig', section)
end

function M.execute_command(name, ...)
  return rpc('runCommand', name, ...)
end

function M.workspace_symbols(query)
  return rpc('getWorkspaceSymbols', query)
end

function M.document_symbols(bufnr)
  return rpc('documentSymbols', bufnr)
end

function M.command_list()
  return rpc('commandList')
end

function M.extension_stats()
  return rpc('extensionStats')
end

return M
