
local M = {}

local unpackFn = unpack
if unpackFn == nil then
  unpackFn = table.unpack
end

M.unpack = unpackFn

function M.sendErrorMsg(msg)
  vim.defer_fn(function()
    vim.api.nvim_call_function('coc#rpc#notify', {'nvim_error_event', {0, 'Lua ' .. _VERSION .. ':'.. msg}})
  end, 10)
end

function M.getCurrentTime()
    return os.clock() * 1000
end

local function errorHandler(err)
    local traceback = debug.traceback(2)
    return err .. "\n" .. traceback
end

-- catch the error and send notification to NodeJS
function M.call(module, func, args)
  local m = require(module)
  local method = m[func]
  local result = nil
  if method ~= nil then
    local ok, err = xpcall(function ()
      result = method(unpackFn(args))
    end, errorHandler)
    if not ok then
      local msg = 'Error on ' .. module .. '[' .. func .. ']" ' .. err
      M.sendErrorMsg(msg)
      error(msg)
    end
  else
    local msg = 'Method "' .. module .. '[' .. func .. ']" not exists'
    M.sendErrorMsg(msg)
    error(msg)
  end
  return result
end
return M
