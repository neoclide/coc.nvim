const fs = require('fs')
const glob = require('glob')
const minimatch = require('minimatch')
const path = require('path')
const resolveFrom = require('resolve-from')
const ternRoot = process.argv[2]
const tern = require(ternRoot)
const ROOT = process.cwd()

function getKind(type) {
  if (type === 'function') return 'fn'
  if (type === 'number') return 'num'
  if (type === 'boolean') return 'bool'
  if (type === 'string') return 'str'
  return type
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
  let projectFile = path.resolve(ROOT, '.tern-project')
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
    let found = findFile(file, projectDir, path.resolve(ternRoot, 'defs'))
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
    let found = findFile(plugin + '.js', projectDir, path.resolve(ternRoot, 'plugin'))
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
    if (mod.hasOwnProperty('initialize')) mod.initialize(ternRoot)
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

let server = startServer(ROOT, genConfig())

// always send the file content, it's not optimized
function doRequest(opt, extraOpts, callback) {
  let {filename, line, col, content} = opt
  let query = Object.assign({}, extraOpts, {
    file: '#0',
    end: {line: line, ch: col},
  })
  let file = {
    type: 'full',
    name: filename,
    text: content,
  }
  let doc = {query: query, files: [file]}
  server.request(doc, function(err, res) {
    if (err) return callback(err)
    callback(null, res)
  })
}

function doDefinition(opt) {
  doRequest(opt, {
    type: 'definition'
  }, function (err, res) {
    if (err) {
      console.error(err.stack)
      process.send('{}')
      return
    }
    process.send(JSON.stringify(res))
  })
}

function doType(opt) {
  let extra = {
    type: 'type',
    preferFunction: opt.preferFunction || false
  }
  doRequest(opt, extra, function (err, res) {
    if (err) {
      console.error(err.stack)
      process.send('{}')
      return
    }
    process.send(JSON.stringify(res))
  })
}

function doComplete(opt) {
  let timeout = setTimeout(function () {
    process.send(JSON.stringify([]))
  }, 2000)
  let extraOpts = {
    type: 'completions',
    types: true,
    guess: false,
    docs: true,
    urls: true,
    origins: true,
    filter: true,
    sort: false,
    inLiteral: false,
    caseInsensitive: true,
    expandWordForward: false,
  }
  doRequest(opt, extraOpts, function (err, res) {
    clearTimeout(timeout)
    if (err) {
      console.error(err.stack)
      return
    }
    let items = []
    for (let i = 0; i < res.completions.length; i++) {
      let completion = res.completions[i]
      let comp = { word: completion.name }
      let type = completion.type
      if (type.slice(0, 3) == 'fn(') {
        comp.abbr = comp.word + type.slice(2)
        comp.kind = 'f'
      } else {
        comp.abbr = comp.word
        comp.kind = getKind(type)
      }

      if (completion.guess) {
        comp.menu = completion.guess
      }
      if (completion.doc) {
        comp.info = completion.doc
      }
      items.push(comp)
    }
    process.send(JSON.stringify(items || []))
  })
}

process.on('message', message => {
  let opt = JSON.parse(message)
  if (opt.action == 'complete') {
    doComplete(opt)
  } else if (opt.action == 'type') {
    doType(opt)
  } else if (opt.action == 'definition') {
    doDefinition(opt)
  } else {
    console.error(opt.action + ' not supported')
  }
})
