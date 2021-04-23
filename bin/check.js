let version = process.version.replace('v', '')
let parts = version.split('.')
function greatThanOrEqual(nums, major, minor) {
  if (nums[0] > major) return true
  if (nums[0] == major && nums[1] >= minor) return true
  return false
}
let numbers = parts.map(function (s) {
  return parseInt(s, 10)
})
if (!greatThanOrEqual(numbers, 10, 12)) {
  throw new Error('node version ' + version + ' < 10.12.0, please upgrade nodejs, or use \`let g:coc_node_path = "/path/to/node"\` in your vimrc')
}
