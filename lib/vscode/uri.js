"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const platform = require("./platform");
const _empty = '';
const _slash = '/';
const _regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;
const _driveLetterPath = /^\/[a-zA-Z]:/;
const _upperCaseDrive = /^(\/)?([A-Z]:)/;
/**
 * Compute `fsPath` for the given uri
 * @param uri
 */
function _makeFsPath(uri) {
    let value;
    if (uri.authority && uri.path.length > 1 && uri.scheme === 'file') {
        // unc path: file://shares/c$/far/boo
        value = `//${uri.authority}${uri.path}`;
    }
    else if (_driveLetterPath.test(uri.path)) {
        // windows drive letter: file:///c:/far/boo
        value = uri.path[1].toLowerCase() + uri.path.substr(2);
    }
    else {
        // other path
        value = uri.path;
    }
    if (platform.isWindows) {
        value = value.replace(/\//g, '\\');
    }
    return value;
}
function _encode(ch) {
    return ('%' +
        ch
            .charCodeAt(0)
            .toString(16)
            .toUpperCase());
}
// see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
function encodeURIComponent2(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, _encode);
}
function encodeNoop(str) {
    return str.replace(/[#?]/, _encode);
}
const _schemePattern = /^\w[\w\d+.-]*$/;
const _singleSlashStart = /^\//;
const _doubleSlashStart = /^\/\//;
function _validateUri(ret) {
    // scheme, https://tools.ietf.org/html/rfc3986#section-3.1
    // ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
    if (ret.scheme && !_schemePattern.test(ret.scheme)) {
        throw new Error('[UriError]: Scheme contains illegal characters.');
    }
    // path, http://tools.ietf.org/html/rfc3986#section-3.3
    // If a URI contains an authority component, then the path component
    // must either be empty or begin with a slash ("/") character.  If a URI
    // does not contain an authority component, then the path cannot begin
    // with two slash characters ("//").
    if (ret.path) {
        if (ret.authority) {
            if (!_singleSlashStart.test(ret.path)) {
                throw new Error('[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash ("/") character');
            }
        }
        else {
            if (_doubleSlashStart.test(ret.path)) {
                throw new Error('[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")');
            }
        }
    }
}
// implements a bit of https://tools.ietf.org/html/rfc3986#section-5
function _referenceResolution(scheme, path) {
    // the slash-character is our 'default base' as we don't
    // support constructing URIs relative to other URIs. This
    // also means that we alter and potentially break paths.
    // see https://tools.ietf.org/html/rfc3986#section-5.1.4
    switch (scheme) {
        case 'https':
        case 'http':
        case 'file':
            if (!path) {
                path = _slash;
            }
            else if (path[0] !== _slash) {
                path = _slash + path;
            }
            break;
    }
    return path;
}
/**
 * Uniform Resource Identifier (URI) http://tools.ietf.org/html/rfc3986.
 * This class is a simple parser which creates the basic component paths
 * (http://tools.ietf.org/html/rfc3986#section-3) with minimal validation
 * and encoding.
 *
 *       foo://example.com:8042/over/there?name=ferret#nose
 *       \_/   \______________/\_________/ \_________/ \__/
 *        |           |            |            |        |
 *     scheme     authority       path        query   fragment
 *        |   _____________________|__
 *       / \ /                        \
 *       urn:example:animal:ferret:nose
 *
 *
 */
class URI {
    /**
     * @internal
     */
    constructor(schemeOrData, authority, path, query, fragment) {
        if (typeof schemeOrData === 'object') {
            this.scheme = schemeOrData.scheme || _empty;
            this.authority = schemeOrData.authority || _empty;
            this.path = schemeOrData.path || _empty;
            this.query = schemeOrData.query || _empty;
            this.fragment = schemeOrData.fragment || _empty;
            // no validation because it's this URI
            // that creates uri components.
            // _validateUri(this)
        }
        else {
            this.scheme = schemeOrData || _empty;
            this.authority = authority || _empty;
            this.path = _referenceResolution(this.scheme, path || _empty);
            this.query = query || _empty;
            this.fragment = fragment || _empty;
            _validateUri(this);
        }
    }
    static revive(data) {
        if (!data) {
            return data;
        }
        else if (data instanceof URI) {
            return data;
        }
        else {
            let result = new _URI(data); // tslint:disable-line
            result._fsPath = data.fsPath;
            result._formatted = data.external;
            return result;
        }
    }
    /**
     * @internal
     */
    static isUri(thing) {
        if (thing instanceof URI) {
            return true;
        }
        if (!thing) {
            return false;
        }
        return (typeof thing.authority === 'string' &&
            typeof thing.fragment === 'string' &&
            typeof thing.path === 'string' &&
            typeof thing.query === 'string' &&
            typeof thing.scheme === 'string');
    }
    // ---- parse & validate ------------------------
    static parse(value) {
        const match = _regexp.exec(value);
        if (!match) {
            return new _URI(_empty, _empty, _empty, _empty, _empty); // tslint:disable-line
        }
        return new _URI(// tslint:disable-line
        match[2] || _empty, decodeURIComponent(match[4] || _empty), decodeURIComponent(match[5] || _empty), decodeURIComponent(match[7] || _empty), decodeURIComponent(match[9] || _empty));
    }
    static file(path) {
        let authority = _empty;
        // normalize to fwd-slashes on windows,
        // on other systems bwd-slashes are valid
        // filename character, eg /f\oo/ba\r.txt
        if (platform.isWindows) {
            path = path.replace(/\\/g, _slash); // tslint:disable-line
        }
        // check for authority as used in UNC shares
        // or use the path as given
        if (path[0] === _slash && path[1] === _slash) {
            let idx = path.indexOf(_slash, 2);
            if (idx === -1) {
                authority = path.substring(2);
                path = _slash;
            }
            else {
                authority = path.substring(2, idx);
                path = path.substring(idx) || _slash;
            }
        }
        return new _URI('file', authority, path, _empty, _empty); // tslint:disable-line
    }
    static from(components) {
        return new _URI(// tslint:disable-line
        components.scheme, components.authority, components.path, components.query, components.fragment);
    }
    // ---- filesystem path -----------------------
    /**
     * Returns a string representing the corresponding file system path of this URI.
     * Will handle UNC paths and normalize windows drive letters to lower-case. Also
     * uses the platform specific path separator. Will *not* validate the path for
     * invalid characters and semantics. Will *not* look at the scheme of this URI.
     */
    get fsPath() {
        return _makeFsPath(this);
    }
    // ---- modify to new -------------------------
    with(change) {
        if (!change) {
            return this;
        }
        let { scheme, authority, path, query, fragment } = change;
        if (scheme === void 0) {
            scheme = this.scheme;
        }
        else if (scheme === null) {
            scheme = _empty;
        }
        if (authority === void 0) {
            authority = this.authority;
        }
        else if (authority === null) {
            authority = _empty;
        }
        if (path === void 0) {
            path = this.path;
        }
        else if (path === null) {
            path = _empty;
        }
        if (query === void 0) {
            query = this.query;
        }
        else if (query === null) {
            query = _empty;
        }
        if (fragment === void 0) {
            fragment = this.fragment;
        }
        else if (fragment === null) {
            fragment = _empty;
        }
        if (scheme === this.scheme &&
            authority === this.authority &&
            path === this.path &&
            query === this.query &&
            fragment === this.fragment) {
            return this;
        }
        return new _URI(scheme, authority, path, query, fragment); // tslint:disable-line
    }
    // ---- printing/externalize ---------------------------
    /**
     *
     * @param skipEncoding Do not encode the result, default is `false`
     */
    toString(skipEncoding = false) {
        return _asFormatted(this, skipEncoding);
    }
    toJSON() {
        const res = {
            $mid: 1,
            fsPath: this.fsPath,
            external: this.toString()
        };
        if (this.path) {
            res.path = this.path;
        }
        if (this.scheme) {
            res.scheme = this.scheme;
        }
        if (this.authority) {
            res.authority = this.authority;
        }
        if (this.query) {
            res.query = this.query;
        }
        if (this.fragment) {
            res.fragment = this.fragment;
        }
        return res;
    }
}
exports.default = URI;
class _URI extends URI {
    constructor() {
        super(...arguments);
        this._formatted = null;
        this._fsPath = null;
    }
    get fsPath() {
        if (!this._fsPath) {
            this._fsPath = _makeFsPath(this);
        }
        return this._fsPath;
    }
    toString(skipEncoding = false) {
        if (!skipEncoding) {
            if (!this._formatted) {
                this._formatted = _asFormatted(this, false);
            }
            return this._formatted;
        }
        else {
            // we don't cache that
            return _asFormatted(this, true);
        }
    }
}
/**
 * Create the external version of a uri
 */
function _asFormatted(uri, skipEncoding) {
    const encoder = !skipEncoding ? encodeURIComponent2 : encodeNoop;
    const parts = [];
    let { scheme, authority, path, query, fragment } = uri;
    if (scheme) {
        parts.push(scheme, ':');
    }
    if (authority || scheme === 'file') {
        parts.push('//');
    }
    if (authority) {
        let idx = authority.indexOf('@');
        if (idx !== -1) {
            const userinfo = authority.substr(0, idx);
            authority = authority.substr(idx + 1);
            idx = userinfo.indexOf(':');
            if (idx === -1) {
                parts.push(encoder(userinfo));
            }
            else {
                parts.push(encoder(userinfo.substr(0, idx)), ':', encoder(userinfo.substr(idx + 1)));
            }
            parts.push('@');
        }
        authority = authority.toLowerCase();
        idx = authority.indexOf(':');
        if (idx === -1) {
            parts.push(encoder(authority));
        }
        else {
            parts.push(encoder(authority.substr(0, idx)), authority.substr(idx));
        }
    }
    if (path) {
        // lower-case windows drive letters in /C:/fff or C:/fff
        const m = _upperCaseDrive.exec(path);
        if (m) {
            if (m[1]) {
                path = '/' + m[2].toLowerCase() + path.substr(3); // "/c:".length === 3
            }
            else {
                path = m[2].toLowerCase() + path.substr(2); // // "c:".length === 2
            }
        }
        // encode every segement but not slashes
        // make sure that # and ? are always encoded
        // when occurring in paths - otherwise the result
        // cannot be parsed back again
        let lastIdx = 0;
        while (true) {
            let idx = path.indexOf(_slash, lastIdx);
            if (idx === -1) {
                parts.push(encoder(path.substring(lastIdx)));
                break;
            }
            parts.push(encoder(path.substring(lastIdx, idx)), _slash);
            lastIdx = idx + 1;
        }
    }
    if (query) {
        parts.push('?', encoder(query));
    }
    if (fragment) {
        parts.push('#', encoder(fragment));
    }
    return parts.join(_empty);
}
//# sourceMappingURL=uri.js.map