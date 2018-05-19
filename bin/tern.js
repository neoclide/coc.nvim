let fs = require('fs')
let glob = require('glob')
let minimatch = require('minimatch')
let path = require('path')
let readline = require('readline')
let resolveFrom = require('resolve-from')
let tern = require('tern')
let findRoot = require('find-root')
const net = require('net')
const os = require('os')

let DIST_DIR = path.resolve(__dirname,'../node_modules/tern')
let PROJECT_FILE_NAME = '.tern-project'
let PROJECT_DIR = ''
try {
  PROJECT_DIR = findRoot(process.cwd(), (dir) => {
    return fs.existsSync(path.join(dir, PROJECT_FILE_NAME))
  })
} catch (e) {
  PROJECT_DIR = process.cwd()
}

function genConfig() {
  let defaultConfig = {
    libs: [],
    loadEagerly: false,
    plugins: {doc_comment: true},
    ecmascript: true,
    ecmaVersion: 6,
    dependencyBudget: tern.defaultOptions.dependencyBudget
  }

  function merge(base, value) {
    if (!base) return value
    if (!value) return base
    let result = {}
    for (let prop in base) result[prop] = base[prop]
    for (let prop in value) result[prop] = value[prop]
    return result
  }

  function readConfig(fileName) {
    let data = readJSON(fileName)
    for (let option in defaultConfig) {
      if (!data.hasOwnProperty(option))
        data[option] = defaultConfig[option]
      else if (option == 'plugins')
        data[option] = merge(defaultConfig[option], data[option])
    }
    return data
  }

  let home = process.env.HOME || process.env.USERPROFILE
  if (home && fs.existsSync(path.resolve(home, '.tern-config'))) {
    defaultConfig = readConfig(path.resolve(home, '.tern-config'))
  }

  let projectFile = path.resolve(PROJECT_DIR, PROJECT_FILE_NAME)
  if (fs.existsSync(projectFile)) {
    return readConfig(projectFile)
  }

  return defaultConfig
}


function readJSON(fileName) {
  let file = fs.readFileSync(fileName, 'utf8')
  try {
    return JSON.parse(file)
  } catch (e) {
    console.error('Bad JSON in ' + fileName + ': ' + e.message)
  }
}


function findFile(file, projectDir, fallbackDir) {
  let local = path.resolve(projectDir, file)
  if (fs.existsSync(local)) return local
  let shared = path.resolve(fallbackDir, file)
  if (fs.existsSync(shared)) return shared
}


function findDefs(projectDir, config) {
  let defs = [], src = config.libs.slice()
  if (src.indexOf('ecmascript') == -1) {
    src.unshift('ecmascript')
  }

  for (let i = 0; i < src.length; ++i) {
    let file = src[i]
    file = /\.json$/.test(file) ? file : `${file}.json`
    let found = findFile(file, projectDir, path.resolve(DIST_DIR, 'defs'))
    if (!found) {
      try {
        found = require.resolve('tern-' + src[i])
      } catch (e) {
        process.stderr.write('Failed to find library ' + src[i] + '.\n')
        continue
      }
    }
    if (found) defs.push(readJSON(found))
  }
  return defs
}


function loadPlugins(projectDir, config) {
  let plugins = config.plugins, options = {}
  for (let plugin in plugins) {
    let val = plugins[plugin]
    if (!val) continue
    let found = findFile(plugin + '.js', projectDir, path.resolve(DIST_DIR, 'plugin'))
        || resolveFrom(projectDir, 'tern-' + plugin)
    if (!found) {
      try {
        found = require.resolve('tern-' + plugin)
      } catch (e) {
        process.stderr.write('Failed to find plugin ' + plugin + '.\n')
        continue
      }
    }
    let mod = require(found)
    if (mod.hasOwnProperty('initialize')) mod.initialize(DIST_DIR)
    options[path.basename(plugin)] = val
  }

  return options
}


function startServer(dir, config) {
  let defs = findDefs(dir, config)
  let plugins = loadPlugins(dir, config)
  let server = new tern.Server({
    getFile: function(name, c) {
      if (config.dontLoad && config.dontLoad.some(function(pat) { return minimatch(name, pat); })) {
        c(null, '')
      } else {
        fs.readFile(path.resolve(dir, name), 'utf8', c)
      }
    },
    normalizeFilename: function(name) {
      let pt = path.resolve(dir, name)
      try {
        pt = fs.realPathSync(path.resolve(dir, name), true)
      } catch(e) {}
      return path.relative(dir, pt)
    },
    async: true,
    defs: defs,
    plugins: plugins,
    projectDir: dir,
    ecmaVersion: config.ecmaVersion,
    dependencyBudget: config.dependencyBudget,
  })

  if (config.loadEagerly) config.loadEagerly.forEach(function(pat) {
    glob.sync(pat, { cwd: dir }).forEach(function(file) {
      server.addFile(file)
    })
  })
  return server
}

let server = startServer(PROJECT_DIR, genConfig())

function complete(filename, line, col, content, callback) {
  let query = {
    type: 'completions',
    types: true,
    guess: false,
    docs: true,
    file: '#0',
    filter: true,
    expandWordForward: false,
    inLiteral: false,
    end: {line: line, ch: col},
  }

  let file = {
    type: 'full',
    name: filename,
    text: content,
  }
  let doc = {query: query, files: [file]}
  server.request(doc, function(err, res) {
    if (err) return callback(err)
    let info = []
    for (let i = 0; i < res.completions.length; i++) {
      let completion = res.completions[i]
      let comp = {word: completion.name, menu: completion.type}

      if (completion.guess) {
        comp.menu += ' ' + completion.guess
      }
      if (completion.doc) {
        comp.info = completion.doc
      }
      info.push(comp)
    }
    callback(null, info)
  })
}

process.on('message', message => {
  let {action, filename, line, col, content} = JSON.parse(message)
  if (action == 'complete') {
    let timeout = setTimeout(function () {
      process.send(JSON.stringify([]))
    }, 3000)
    complete(filename, line, col, content, function (err, items) {
      clearTimeout(timeout)
      if (err) {
        console.error(err.stack)
      }
      process.send(JSON.stringify(items || []))
    })
  }
})
