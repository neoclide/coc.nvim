const fs = require('fs')

let content = fs.readFileSync('./config.json', 'utf8')

let o = JSON.parse(content)
console.log(o)

function iterate(obj, parents, key) {
  let res = obj[key]
  if (typeof res === 'object') {
    let arr = parents.concat([key])
    for (let k of Object.keys(res)) {
      iterate(res, arr, k)
    }
  } else if (res !== undefined) {
    console.log(`"${parents.concat([key]).join('.')}" : ${res}`)
  }
}

for (let key of Object.keys(o)) {
  iterate(o, [], key)
}
