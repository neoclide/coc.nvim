"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let _isWindows = false;
let _isMacintosh = false;
let _isLinux = false;
let _isNative = false;
let _isWeb = false;
exports.language = 'en';
// OS detection
if (typeof process === 'object' &&
    typeof process.nextTick === 'function' &&
    typeof process.platform === 'string') {
    _isWindows = process.platform === 'win32';
    _isMacintosh = process.platform === 'darwin';
    _isLinux = process.platform === 'linux';
    _isNative = true;
}
var Platform;
(function (Platform) {
    Platform[Platform["Web"] = 0] = "Web";
    Platform[Platform["Mac"] = 1] = "Mac";
    Platform[Platform["Linux"] = 2] = "Linux";
    Platform[Platform["Windows"] = 3] = "Windows";
})(Platform = exports.Platform || (exports.Platform = {}));
let _platform = Platform.Web;
if (_isNative) {
    if (_isMacintosh) {
        _platform = Platform.Mac;
    }
    else if (_isWindows) {
        _platform = Platform.Windows;
    }
    else if (_isLinux) {
        _platform = Platform.Linux;
    }
}
exports.isWindows = _isWindows;
exports.isMacintosh = _isMacintosh;
exports.isLinux = _isLinux;
exports.isNative = _isNative;
exports.isWeb = _isWeb;
exports.platform = _platform;
const _globals = typeof self === 'object'
    ? self
    : typeof global === 'object'
        ? global
        : {};
exports.globals = _globals;
exports.OS = _isMacintosh
    ? 2 /* Macintosh */
    : _isWindows
        ? 1 /* Windows */
        : 3 /* Linux */;
//# sourceMappingURL=platform.js.map