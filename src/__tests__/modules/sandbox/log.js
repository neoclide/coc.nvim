const {wait, nvim} = require('coc.nvim')
console.log('log')
console.debug('debug')
console.info('info')
console.error('error')
console.warn('warn')
module.exports = () => {
  return {wait, nvim}
}
