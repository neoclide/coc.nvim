"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const jsonc_parser_1 = require("jsonc-parser");
const is_1 = require("../util/is");
const object_1 = require("../util/object");
const fs_1 = tslib_1.__importDefault(require("fs"));
const vscode_uri_1 = require("vscode-uri");
const path_1 = tslib_1.__importDefault(require("path"));
const logger = require('../util/logger')('configuration-util');
const isWebpack = typeof __webpack_require__ === "function";
const pluginRoot = isWebpack ? path_1.default.dirname(__dirname) : path_1.default.resolve(__dirname, '../..');
function parseContentFromFile(filepath, onError) {
    if (!filepath || !fs_1.default.existsSync(filepath))
        return { contents: {} };
    let content;
    let uri = vscode_uri_1.URI.file(filepath).toString();
    try {
        content = fs_1.default.readFileSync(filepath, 'utf8');
    }
    catch (_e) {
        content = '';
    }
    let [errors, contents] = parseConfiguration(content);
    if (errors && errors.length) {
        onError(convertErrors(uri, content, errors));
    }
    return { contents };
}
exports.parseContentFromFile = parseContentFromFile;
function parseConfiguration(content) {
    if (content.length == 0)
        return [[], {}];
    let errors = [];
    let data = jsonc_parser_1.parse(content, errors, { allowTrailingComma: true });
    function addProperty(current, key, remains, value) {
        if (remains.length == 0) {
            current[key] = convert(value);
        }
        else {
            if (!current[key])
                current[key] = {};
            let o = current[key];
            let first = remains.shift();
            addProperty(o, first, remains, value);
        }
    }
    function convert(obj, split = false) {
        if (!is_1.objectLiteral(obj))
            return obj;
        if (is_1.emptyObject(obj))
            return {};
        let dest = {};
        for (let key of Object.keys(obj)) {
            if (split && key.indexOf('.') !== -1) {
                let parts = key.split('.');
                let first = parts.shift();
                addProperty(dest, first, parts, obj[key]);
            }
            else {
                dest[key] = convert(obj[key]);
            }
        }
        return dest;
    }
    return [errors, convert(data, true)];
}
exports.parseConfiguration = parseConfiguration;
function convertErrors(uri, content, errors) {
    let items = [];
    let document = vscode_languageserver_protocol_1.TextDocument.create(uri, 'json', 0, content);
    for (let err of errors) {
        let msg = 'parse error';
        switch (err.error) {
            case 2:
                msg = 'invalid number';
                break;
            case 8:
                msg = 'close brace expected';
                break;
            case 5:
                msg = 'colon expected';
                break;
            case 6:
                msg = 'comma expected';
                break;
            case 9:
                msg = 'end of file expected';
                break;
            case 16:
                msg = 'invaliad character';
                break;
            case 10:
                msg = 'invalid commment token';
                break;
            case 15:
                msg = 'invalid escape character';
                break;
            case 1:
                msg = 'invalid symbol';
                break;
            case 14:
                msg = 'invalid unicode';
                break;
            case 3:
                msg = 'property name expected';
                break;
            case 13:
                msg = 'unexpected end of number';
                break;
            case 12:
                msg = 'unexpected end of string';
                break;
            case 11:
                msg = 'unexpected end of comment';
                break;
            case 4:
                msg = 'value expected';
                break;
            default:
                msg = 'Unknwn error';
                break;
        }
        let range = {
            start: document.positionAt(err.offset),
            end: document.positionAt(err.offset + err.length),
        };
        let loc = vscode_languageserver_protocol_1.Location.create(uri, range);
        items.push({ location: loc, message: msg });
    }
    return items;
}
exports.convertErrors = convertErrors;
function addToValueTree(settingsTreeRoot, key, value, conflictReporter) {
    const segments = key.split('.');
    const last = segments.pop();
    let curr = settingsTreeRoot;
    for (let i = 0; i < segments.length; i++) {
        let s = segments[i];
        let obj = curr[s];
        switch (typeof obj) {
            case 'function': {
                obj = curr[s] = {};
                break;
            }
            case 'undefined': {
                obj = curr[s] = {};
                break;
            }
            case 'object':
                break;
            default:
                conflictReporter(`Ignoring ${key} as ${segments
                    .slice(0, i + 1)
                    .join('.')} is ${JSON.stringify(obj)}`);
                return;
        }
        curr = obj;
    }
    if (typeof curr === 'object') {
        curr[last] = value; // workaround https://github.com/Microsoft/vscode/issues/13606
    }
    else {
        conflictReporter(`Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`);
    }
}
exports.addToValueTree = addToValueTree;
function removeFromValueTree(valueTree, key) {
    const segments = key.split('.');
    doRemoveFromValueTree(valueTree, segments);
}
exports.removeFromValueTree = removeFromValueTree;
function doRemoveFromValueTree(valueTree, segments) {
    const first = segments.shift();
    if (segments.length === 0) {
        // Reached last segment
        delete valueTree[first];
        return;
    }
    if (Object.keys(valueTree).indexOf(first) !== -1) {
        const value = valueTree[first];
        if (typeof value === 'object' && !Array.isArray(value)) {
            doRemoveFromValueTree(value, segments);
            if (Object.keys(value).length === 0) {
                delete valueTree[first];
            }
        }
    }
}
function getConfigurationValue(config, settingPath, defaultValue) {
    function accessSetting(config, path) {
        let current = config;
        for (let i = 0; i < path.length; i++) { // tslint:disable-line
            if (typeof current !== 'object' || current === null) {
                return undefined;
            }
            current = current[path[i]];
        }
        return current;
    }
    const path = settingPath.split('.');
    const result = accessSetting(config, path);
    return typeof result === 'undefined' ? defaultValue : result;
}
exports.getConfigurationValue = getConfigurationValue;
function loadDefaultConfigurations() {
    let file = path_1.default.join(pluginRoot, 'data/schema.json');
    if (!fs_1.default.existsSync(file)) {
        console.error('schema.json not found, reinstall coc.nvim to fix this!'); // tslint:disable-line
        return { contents: {} };
    }
    let content = fs_1.default.readFileSync(file, 'utf8');
    let { properties } = JSON.parse(content);
    let config = {};
    Object.keys(properties).forEach(key => {
        let value = properties[key].default;
        if (value !== undefined) {
            addToValueTree(config, key, value, message => {
                logger.error(message); // tslint:disable-line
            });
        }
    });
    return { contents: config };
}
exports.loadDefaultConfigurations = loadDefaultConfigurations;
function getKeys(obj, curr) {
    let keys = [];
    for (let key of Object.keys(obj)) {
        let val = obj[key];
        let newKey = curr ? `${curr}.${key}` : key;
        keys.push(newKey);
        if (is_1.objectLiteral(val)) {
            keys.push(...getKeys(val, newKey));
        }
    }
    return keys;
}
exports.getKeys = getKeys;
function getChangedKeys(from, to) {
    let keys = [];
    let fromKeys = getKeys(from);
    let toKeys = getKeys(to);
    const added = toKeys.filter(key => fromKeys.indexOf(key) === -1);
    const removed = fromKeys.filter(key => toKeys.indexOf(key) === -1);
    keys.push(...added);
    keys.push(...removed);
    for (const key of fromKeys) {
        if (toKeys.indexOf(key) == -1)
            continue;
        const value1 = getConfigurationValue(from, key);
        const value2 = getConfigurationValue(to, key);
        if (!object_1.equals(value1, value2)) {
            keys.push(key);
        }
    }
    return keys;
}
exports.getChangedKeys = getChangedKeys;
//# sourceMappingURL=util.js.map