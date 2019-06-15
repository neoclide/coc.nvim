"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const logger = require('../util/logger')('snippets-parser');
class Scanner {
    constructor() {
        this.text('');
    }
    static isDigitCharacter(ch) {
        return ch >= 48 /* Digit0 */ && ch <= 57 /* Digit9 */;
    }
    static isVariableCharacter(ch) {
        return ch === 95 /* Underline */
            || (ch >= 97 /* a */ && ch <= 122 /* z */)
            || (ch >= 65 /* A */ && ch <= 90 /* Z */);
    }
    text(value) {
        this.value = value;
        this.pos = 0;
    }
    tokenText(token) {
        return this.value.substr(token.pos, token.len);
    }
    next() {
        if (this.pos >= this.value.length) {
            return { type: 14 /* EOF */, pos: this.pos, len: 0 };
        }
        let pos = this.pos;
        let len = 0;
        let ch = this.value.charCodeAt(pos);
        let type;
        // static types
        type = Scanner._table[ch];
        if (typeof type === 'number') {
            this.pos += 1;
            return { type, pos, len: 1 };
        }
        // number
        if (Scanner.isDigitCharacter(ch)) {
            type = 8 /* Int */;
            do {
                len += 1;
                ch = this.value.charCodeAt(pos + len);
            } while (Scanner.isDigitCharacter(ch));
            this.pos += len;
            return { type, pos, len };
        }
        // variable name
        if (Scanner.isVariableCharacter(ch)) {
            type = 9 /* VariableName */;
            do {
                ch = this.value.charCodeAt(pos + (++len));
            } while (Scanner.isVariableCharacter(ch) || Scanner.isDigitCharacter(ch));
            this.pos += len;
            return { type, pos, len };
        }
        // format
        type = 10 /* Format */;
        do {
            len += 1;
            ch = this.value.charCodeAt(pos + len);
        } while (!isNaN(ch)
            && typeof Scanner._table[ch] === 'undefined' // not static token
            && !Scanner.isDigitCharacter(ch) // not number
            && !Scanner.isVariableCharacter(ch) // not variable
        );
        this.pos += len;
        return { type, pos, len };
    }
}
Scanner._table = {
    [36 /* DollarSign */]: 0 /* Dollar */,
    [58 /* Colon */]: 1 /* Colon */,
    [44 /* Comma */]: 2 /* Comma */,
    [123 /* OpenCurlyBrace */]: 3 /* CurlyOpen */,
    [125 /* CloseCurlyBrace */]: 4 /* CurlyClose */,
    [92 /* Backslash */]: 5 /* Backslash */,
    [47 /* Slash */]: 6 /* Forwardslash */,
    [124 /* Pipe */]: 7 /* Pipe */,
    [43 /* Plus */]: 11 /* Plus */,
    [45 /* Dash */]: 12 /* Dash */,
    [63 /* QuestionMark */]: 13 /* QuestionMark */,
};
exports.Scanner = Scanner;
class Marker {
    constructor() {
        this._children = [];
    }
    appendChild(child) {
        if (child instanceof Text && this._children[this._children.length - 1] instanceof Text) {
            // this and previous child are text -> merge them
            this._children[this._children.length - 1].value += child.value;
        }
        else {
            // normal adoption of child
            child.parent = this;
            this._children.push(child);
        }
        return this;
    }
    setOnlyChild(child) {
        child.parent = this;
        this._children = [child];
    }
    replace(child, others) {
        const { parent } = child;
        const idx = parent.children.indexOf(child);
        const newChildren = parent.children.slice(0);
        newChildren.splice(idx, 1, ...others);
        parent._children = newChildren;
        (function _fixParent(children, parent) {
            for (const child of children) {
                child.parent = parent;
                _fixParent(child.children, child);
            }
        })(others, parent);
    }
    get children() {
        return this._children;
    }
    get snippet() {
        let candidate = this;
        while (true) {
            if (!candidate) {
                return undefined;
            }
            if (candidate instanceof TextmateSnippet) {
                return candidate;
            }
            candidate = candidate.parent;
        }
    }
    toString() {
        return this.children.reduce((prev, cur) => prev + cur.toString(), '');
    }
    len() {
        return 0;
    }
    get next() {
        let { parent } = this;
        let { children } = parent;
        let idx = children.indexOf(this);
        return children[idx + 1];
    }
}
exports.Marker = Marker;
class Text extends Marker {
    constructor(value) {
        super();
        this.value = value;
    }
    static escape(value) {
        return value.replace(/\$|}|\\/g, '\\$&');
    }
    toString() {
        return this.value;
    }
    toTextmateString() {
        return Text.escape(this.value);
    }
    len() {
        return this.value.length;
    }
    clone() {
        return new Text(this.value);
    }
}
exports.Text = Text;
class TransformableMarker extends Marker {
}
exports.TransformableMarker = TransformableMarker;
class Placeholder extends TransformableMarker {
    constructor(index) {
        super();
        this.index = index;
    }
    static compareByIndex(a, b) {
        if (a.index === b.index) {
            return 0;
        }
        else if (a.isFinalTabstop) {
            return 1;
        }
        else if (b.isFinalTabstop) {
            return -1;
        }
        else if (a.index < b.index) {
            return -1;
        }
        else if (a.index > b.index) {
            return 1;
        }
        else {
            return 0;
        }
    }
    get isFinalTabstop() {
        return this.index === 0;
    }
    get choice() {
        return this._children.length === 1 && this._children[0] instanceof Choice
            ? this._children[0]
            : undefined;
    }
    toTextmateString() {
        let transformString = '';
        if (this.transform) {
            transformString = this.transform.toTextmateString();
        }
        if (this.children.length === 0 && !this.transform) {
            return `\$${this.index}`;
        }
        else if (this.children.length === 0) {
            return `\${${this.index}${transformString}}`;
        }
        else if (this.choice) {
            return `\${${this.index}|${this.choice.toTextmateString()}|${transformString}}`;
        }
        else {
            return `\${${this.index}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`;
        }
    }
    clone() {
        let ret = new Placeholder(this.index);
        if (this.transform) {
            ret.transform = this.transform.clone();
        }
        ret._children = this.children.map(child => child.clone());
        return ret;
    }
}
exports.Placeholder = Placeholder;
class Choice extends Marker {
    constructor() {
        super(...arguments);
        this.options = [];
    }
    appendChild(marker) {
        if (marker instanceof Text) {
            marker.parent = this;
            this.options.push(marker);
        }
        return this;
    }
    toString() {
        return this.options[0].value;
    }
    toTextmateString() {
        return this.options
            .map(option => option.value.replace(/\||,/g, '\\$&'))
            .join(',');
    }
    len() {
        return this.options[0].len();
    }
    clone() {
        let ret = new Choice();
        for (let opt of this.options) {
            ret.appendChild(opt);
        }
        return ret;
    }
}
exports.Choice = Choice;
class Transform extends Marker {
    resolve(value) {
        let didMatch = false;
        let ret = value.replace(this.regexp, (...args) => {
            didMatch = true;
            return this._replace(args.slice(0, -2));
        });
        // when the regex didn't match and when the transform has
        // else branches, then run those
        if (!didMatch && this._children.some(child => child instanceof FormatString && Boolean(child.elseValue))) {
            ret = this._replace([]);
        }
        return ret;
    }
    _replace(groups) {
        let ret = '';
        for (const marker of this._children) {
            if (marker instanceof FormatString) {
                let value = groups[marker.index] || '';
                value = marker.resolve(value);
                ret += value;
            }
            else {
                ret += marker.toString();
            }
        }
        return ret;
    }
    toString() {
        return '';
    }
    toTextmateString() {
        return `/${this.regexp.source}/${this.children.map(c => c.toTextmateString())}/${(this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : '')}`;
    }
    clone() {
        let ret = new Transform();
        ret.regexp = new RegExp(this.regexp.source, '' + (this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : ''));
        ret._children = this.children.map(child => child.clone());
        return ret;
    }
}
exports.Transform = Transform;
class FormatString extends Marker {
    constructor(index, shorthandName, ifValue, elseValue) {
        super();
        this.index = index;
        this.shorthandName = shorthandName;
        this.ifValue = ifValue;
        this.elseValue = elseValue;
    }
    resolve(value) {
        if (this.shorthandName === 'upcase') {
            return !value ? '' : value.toLocaleUpperCase();
        }
        else if (this.shorthandName === 'downcase') {
            return !value ? '' : value.toLocaleLowerCase();
        }
        else if (this.shorthandName === 'capitalize') {
            return !value ? '' : (value[0].toLocaleUpperCase() + value.substr(1));
        }
        else if (this.shorthandName === 'pascalcase') {
            return !value ? '' : this._toPascalCase(value);
        }
        else if (Boolean(value) && typeof this.ifValue === 'string') {
            return this.ifValue;
        }
        else if (!Boolean(value) && typeof this.elseValue === 'string') {
            return this.elseValue;
        }
        else {
            return value || '';
        }
    }
    _toPascalCase(value) {
        const match = value.match(/[a-z]+/gi);
        if (!match) {
            return value;
        }
        return match.map(word => {
            return word.charAt(0).toUpperCase()
                + word.substr(1).toLowerCase();
        })
            .join('');
    }
    toTextmateString() {
        let value = '${';
        value += this.index;
        if (this.shorthandName) {
            value += `:/${this.shorthandName}`;
        }
        else if (this.ifValue && this.elseValue) {
            value += `:?${this.ifValue}:${this.elseValue}`;
        }
        else if (this.ifValue) {
            value += `:+${this.ifValue}`;
        }
        else if (this.elseValue) {
            value += `:-${this.elseValue}`;
        }
        value += '}';
        return value;
    }
    clone() {
        let ret = new FormatString(this.index, this.shorthandName, this.ifValue, this.elseValue);
        return ret;
    }
}
exports.FormatString = FormatString;
class Variable extends TransformableMarker {
    constructor(name) {
        super();
        this.name = name;
    }
    resolve(resolver) {
        let value = resolver.resolve(this);
        if (value && value.indexOf('\n') !== -1) {
            // get indent of previous Text child
            let { children } = this.parent;
            let idx = children.indexOf(this);
            let previous = children[idx - 1];
            if (previous && previous instanceof Text) {
                let ms = previous.value.match(/\n([ \t]*)$/);
                if (ms) {
                    let newLines = value.split('\n').map((s, i) => {
                        return i == 0 ? s : ms[1] + s.replace(/^\s*/, '');
                    });
                    value = newLines.join('\n');
                }
            }
        }
        if (this.transform) {
            value = this.transform.resolve(value || '');
        }
        if (value !== undefined) {
            this._children = [new Text(value)];
            return true;
        }
        return false;
    }
    toTextmateString() {
        let transformString = '';
        if (this.transform) {
            transformString = this.transform.toTextmateString();
        }
        if (this.children.length === 0) {
            return `\${${this.name}${transformString}}`;
        }
        else {
            return `\${${this.name}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`;
        }
    }
    clone() {
        const ret = new Variable(this.name);
        if (this.transform) {
            ret.transform = this.transform.clone();
        }
        ret._children = this.children.map(child => child.clone());
        return ret;
    }
}
exports.Variable = Variable;
function walk(marker, visitor) {
    const stack = [...marker];
    while (stack.length > 0) {
        const marker = stack.shift();
        const recurse = visitor(marker);
        if (!recurse) {
            break;
        }
        stack.unshift(...marker.children);
    }
}
class TextmateSnippet extends Marker {
    get placeholderInfo() {
        if (!this._placeholders) {
            // fill in placeholders
            let all = [];
            let last;
            this.walk(candidate => {
                if (candidate instanceof Placeholder) {
                    all.push(candidate);
                    last = !last || last.index < candidate.index ? candidate : last;
                }
                return true;
            });
            this._placeholders = { all, last };
        }
        return this._placeholders;
    }
    get placeholders() {
        const { all } = this.placeholderInfo;
        return all;
    }
    get maxIndexNumber() {
        let { placeholders } = this;
        return placeholders.reduce((curr, p) => {
            return Math.max(curr, p.index);
        }, 0);
    }
    get minIndexNumber() {
        let { placeholders } = this;
        let nums = placeholders.map(p => p.index);
        nums.sort((a, b) => a - b);
        if (nums.length > 1 && nums[0] == 0)
            return nums[1];
        return nums[0] || 0;
    }
    insertSnippet(snippet, id, range) {
        let placeholder = this.placeholders[id];
        if (!placeholder)
            return;
        let { index } = placeholder;
        const document = vscode_languageserver_protocol_1.TextDocument.create('untitled:/1', 'snippet', 0, placeholder.toString());
        snippet = vscode_languageserver_protocol_1.TextDocument.applyEdits(document, [{ range, newText: snippet.replace(/\$0$/, '') }]);
        let nested = new SnippetParser().parse(snippet, false);
        let maxIndexAdded = nested.maxIndexNumber;
        let totalAdd = maxIndexAdded + -1;
        for (let p of nested.placeholders) {
            if (p.isFinalTabstop) {
                p.index = maxIndexAdded + index + 1;
            }
            else {
                p.index = p.index + index;
            }
        }
        this.walk(m => {
            if (m instanceof Placeholder && m.index > index) {
                m.index = m.index + totalAdd + 1;
            }
            return true;
        });
        this.replace(placeholder, nested.children);
        return index + 1;
    }
    updatePlaceholder(id, val) {
        const placeholder = this.placeholders[id];
        for (let p of this.placeholders) {
            if (p.index == placeholder.index) {
                let child = p.children[0];
                let newText = p.transform ? p.transform.resolve(val) : val;
                if (child) {
                    p.setOnlyChild(new Text(newText));
                }
                else {
                    p.appendChild(new Text(newText));
                }
            }
        }
        this._placeholders = undefined;
    }
    /**
     * newText after update with value
     */
    getPlaceholderText(id, value) {
        const placeholder = this.placeholders[id];
        if (!placeholder)
            return value;
        return placeholder.transform ? placeholder.transform.resolve(value) : value;
    }
    offset(marker) {
        let pos = 0;
        let found = false;
        this.walk(candidate => {
            if (candidate === marker) {
                found = true;
                return false;
            }
            pos += candidate.len();
            return true;
        });
        if (!found) {
            return -1;
        }
        return pos;
    }
    fullLen(marker) {
        let ret = 0;
        walk([marker], marker => {
            ret += marker.len();
            return true;
        });
        return ret;
    }
    enclosingPlaceholders(placeholder) {
        let ret = [];
        let { parent } = placeholder;
        while (parent) {
            if (parent instanceof Placeholder) {
                ret.push(parent);
            }
            parent = parent.parent;
        }
        return ret;
    }
    resolveVariables(resolver) {
        this.walk(candidate => {
            if (candidate instanceof Variable) {
                if (candidate.resolve(resolver)) {
                    this._placeholders = undefined;
                }
            }
            return true;
        });
        return this;
    }
    appendChild(child) {
        this._placeholders = undefined;
        return super.appendChild(child);
    }
    replace(child, others) {
        this._placeholders = undefined;
        return super.replace(child, others);
    }
    toTextmateString() {
        return this.children.reduce((prev, cur) => prev + cur.toTextmateString(), '');
    }
    clone() {
        let ret = new TextmateSnippet();
        this._children = this.children.map(child => child.clone());
        return ret;
    }
    walk(visitor) {
        walk(this.children, visitor);
    }
}
exports.TextmateSnippet = TextmateSnippet;
class SnippetParser {
    constructor() {
        this._scanner = new Scanner();
    }
    static escape(value) {
        return value.replace(/\$|}|\\/g, '\\$&');
    }
    text(value) {
        return this.parse(value).toString();
    }
    parse(value, insertFinalTabstop) {
        this._scanner.text(value);
        this._token = this._scanner.next();
        const snippet = new TextmateSnippet();
        while (this._parse(snippet)) {
            // nothing
        }
        // fill in values for placeholders. the first placeholder of an index
        // that has a value defines the value for all placeholders with that index
        const placeholderDefaultValues = new Map();
        const incompletePlaceholders = [];
        snippet.walk(marker => {
            if (marker instanceof Placeholder) {
                if (marker.isFinalTabstop) {
                    placeholderDefaultValues.set(0, undefined);
                }
                else if (!placeholderDefaultValues.has(marker.index) && marker.children.length > 0) {
                    placeholderDefaultValues.set(marker.index, marker.children);
                }
                else {
                    incompletePlaceholders.push(marker);
                }
            }
            return true;
        });
        for (const placeholder of incompletePlaceholders) {
            if (placeholderDefaultValues.has(placeholder.index)) {
                const clone = new Placeholder(placeholder.index);
                clone.transform = placeholder.transform;
                for (const child of placeholderDefaultValues.get(placeholder.index)) {
                    let marker = child.clone();
                    if (clone.transform) {
                        if (marker instanceof Text) {
                            marker = new Text(clone.transform.resolve(marker.value));
                        }
                        else {
                            for (let child of marker.children) {
                                if (child instanceof Text) {
                                    marker.replace(child, [new Text(clone.transform.resolve(child.value))]);
                                    break;
                                }
                            }
                        }
                    }
                    clone.appendChild(marker);
                }
                snippet.replace(placeholder, [clone]);
            }
        }
        if (!placeholderDefaultValues.has(0) && insertFinalTabstop) {
            // the snippet uses placeholders but has no
            // final tabstop defined -> insert at the end
            snippet.appendChild(new Placeholder(0));
        }
        return snippet;
    }
    _accept(type, value) {
        if (type === undefined || this._token.type === type) {
            let ret = !value ? true : this._scanner.tokenText(this._token);
            this._token = this._scanner.next();
            return ret;
        }
        return false;
    }
    _backTo(token) {
        this._scanner.pos = token.pos + token.len;
        this._token = token;
        return false;
    }
    _until(type) {
        if (this._token.type === 14 /* EOF */) {
            return false;
        }
        let start = this._token;
        while (this._token.type !== type) {
            this._token = this._scanner.next();
            if (this._token.type === 14 /* EOF */) {
                return false;
            }
        }
        let value = this._scanner.value.substring(start.pos, this._token.pos);
        this._token = this._scanner.next();
        return value;
    }
    _parse(marker) {
        return this._parseEscaped(marker)
            || this._parseTabstopOrVariableName(marker)
            || this._parseComplexPlaceholder(marker)
            || this._parseComplexVariable(marker)
            || this._parseAnything(marker);
    }
    // \$, \\, \} -> just text
    _parseEscaped(marker) {
        let value;
        if (value = this._accept(5 /* Backslash */, true)) { // tslint:disable-line
            // saw a backslash, append escaped token or that backslash
            value = this._accept(0 /* Dollar */, true)
                || this._accept(4 /* CurlyClose */, true)
                || this._accept(5 /* Backslash */, true)
                || value;
            marker.appendChild(new Text(value));
            return true;
        }
        return false;
    }
    // $foo -> variable, $1 -> tabstop
    _parseTabstopOrVariableName(parent) {
        let value;
        const token = this._token;
        const match = this._accept(0 /* Dollar */)
            && (value = this._accept(9 /* VariableName */, true) || this._accept(8 /* Int */, true));
        if (!match) {
            return this._backTo(token);
        }
        parent.appendChild(/^\d+$/.test(value)
            ? new Placeholder(Number(value))
            : new Variable(value));
        return true;
    }
    // ${1:<children>}, ${1} -> placeholder
    _parseComplexPlaceholder(parent) {
        let index;
        const token = this._token;
        const match = this._accept(0 /* Dollar */)
            && this._accept(3 /* CurlyOpen */)
            && (index = this._accept(8 /* Int */, true));
        if (!match) {
            return this._backTo(token);
        }
        const placeholder = new Placeholder(Number(index));
        if (this._accept(1 /* Colon */)) {
            // ${1:<children>}
            while (true) {
                // ...} -> done
                if (this._accept(4 /* CurlyClose */)) {
                    parent.appendChild(placeholder);
                    return true;
                }
                if (this._parse(placeholder)) {
                    continue;
                }
                // fallback
                parent.appendChild(new Text('${' + index + ':'));
                placeholder.children.forEach(parent.appendChild, parent);
                return true;
            }
        }
        else if (placeholder.index > 0 && this._accept(7 /* Pipe */)) {
            // ${1|one,two,three|}
            const choice = new Choice();
            while (true) {
                if (this._parseChoiceElement(choice)) {
                    if (this._accept(2 /* Comma */)) {
                        // opt, -> more
                        continue;
                    }
                    if (this._accept(7 /* Pipe */)) {
                        placeholder.appendChild(choice);
                        if (this._accept(4 /* CurlyClose */)) {
                            // ..|} -> done
                            parent.appendChild(placeholder);
                            return true;
                        }
                    }
                }
                this._backTo(token);
                return false;
            }
        }
        else if (this._accept(6 /* Forwardslash */)) {
            // ${1/<regex>/<format>/<options>}
            if (this._parseTransform(placeholder)) {
                parent.appendChild(placeholder);
                return true;
            }
            this._backTo(token);
            return false;
        }
        else if (this._accept(4 /* CurlyClose */)) {
            // ${1}
            parent.appendChild(placeholder);
            return true;
        }
        else {
            // ${1 <- missing curly or colon
            return this._backTo(token);
        }
    }
    _parseChoiceElement(parent) {
        const token = this._token;
        const values = [];
        while (true) {
            if (this._token.type === 2 /* Comma */ || this._token.type === 7 /* Pipe */) {
                break;
            }
            let value;
            if (value = this._accept(5 /* Backslash */, true)) { // tslint:disable-line
                // \, \|, or \\
                value = this._accept(2 /* Comma */, true)
                    || this._accept(7 /* Pipe */, true)
                    || this._accept(5 /* Backslash */, true)
                    || value;
            }
            else {
                value = this._accept(undefined, true);
            }
            if (!value) {
                // EOF
                this._backTo(token);
                return false;
            }
            values.push(value);
        }
        if (values.length === 0) {
            this._backTo(token);
            return false;
        }
        parent.appendChild(new Text(values.join('')));
        return true;
    }
    // ${foo:<children>}, ${foo} -> variable
    _parseComplexVariable(parent) {
        let name;
        const token = this._token;
        const match = this._accept(0 /* Dollar */)
            && this._accept(3 /* CurlyOpen */)
            && (name = this._accept(9 /* VariableName */, true));
        if (!match) {
            return this._backTo(token);
        }
        const variable = new Variable(name);
        if (this._accept(1 /* Colon */)) {
            // ${foo:<children>}
            while (true) {
                // ...} -> done
                if (this._accept(4 /* CurlyClose */)) {
                    parent.appendChild(variable);
                    return true;
                }
                if (this._parse(variable)) {
                    continue;
                }
                // fallback
                parent.appendChild(new Text('${' + name + ':'));
                variable.children.forEach(parent.appendChild, parent);
                return true;
            }
        }
        else if (this._accept(6 /* Forwardslash */)) {
            // ${foo/<regex>/<format>/<options>}
            if (this._parseTransform(variable)) {
                parent.appendChild(variable);
                return true;
            }
            this._backTo(token);
            return false;
        }
        else if (this._accept(4 /* CurlyClose */)) {
            // ${foo}
            parent.appendChild(variable);
            return true;
        }
        else {
            // ${foo <- missing curly or colon
            return this._backTo(token);
        }
    }
    _parseTransform(parent) {
        // ...<regex>/<format>/<options>}
        let transform = new Transform();
        let regexValue = '';
        let regexOptions = '';
        // (1) /regex
        while (true) {
            if (this._accept(6 /* Forwardslash */)) {
                break;
            }
            let escaped;
            if (escaped = this._accept(5 /* Backslash */, true)) { // tslint:disable-line
                escaped = this._accept(6 /* Forwardslash */, true) || escaped;
                regexValue += escaped;
                continue;
            }
            if (this._token.type !== 14 /* EOF */) {
                regexValue += this._accept(undefined, true);
                continue;
            }
            return false;
        }
        // (2) /format
        while (true) {
            if (this._accept(6 /* Forwardslash */)) {
                break;
            }
            let escaped;
            if (escaped = this._accept(5 /* Backslash */, true)) { // tslint:disable-line
                escaped = this._accept(6 /* Forwardslash */, true) || escaped;
                transform.appendChild(new Text(escaped));
                continue;
            }
            if (this._parseFormatString(transform) || this._parseAnything(transform)) {
                continue;
            }
            return false;
        }
        // (3) /option
        while (true) {
            if (this._accept(4 /* CurlyClose */)) {
                break;
            }
            if (this._token.type !== 14 /* EOF */) {
                regexOptions += this._accept(undefined, true);
                continue;
            }
            return false;
        }
        try {
            transform.regexp = new RegExp(regexValue, regexOptions);
        }
        catch (e) {
            // invalid regexp
            return false;
        }
        parent.transform = transform;
        return true;
    }
    _parseFormatString(parent) {
        const token = this._token;
        if (!this._accept(0 /* Dollar */)) {
            return false;
        }
        let complex = false;
        if (this._accept(3 /* CurlyOpen */)) {
            complex = true;
        }
        let index = this._accept(8 /* Int */, true);
        if (!index) {
            this._backTo(token);
            return false;
        }
        else if (!complex) {
            // $1
            parent.appendChild(new FormatString(Number(index)));
            return true;
        }
        else if (this._accept(4 /* CurlyClose */)) {
            // ${1}
            parent.appendChild(new FormatString(Number(index)));
            return true;
        }
        else if (!this._accept(1 /* Colon */)) {
            this._backTo(token);
            return false;
        }
        if (this._accept(6 /* Forwardslash */)) {
            // ${1:/upcase}
            let shorthand = this._accept(9 /* VariableName */, true);
            if (!shorthand || !this._accept(4 /* CurlyClose */)) {
                this._backTo(token);
                return false;
            }
            else {
                parent.appendChild(new FormatString(Number(index), shorthand));
                return true;
            }
        }
        else if (this._accept(11 /* Plus */)) {
            // ${1:+<if>}
            let ifValue = this._until(4 /* CurlyClose */);
            if (ifValue) {
                parent.appendChild(new FormatString(Number(index), undefined, ifValue, undefined));
                return true;
            }
        }
        else if (this._accept(12 /* Dash */)) {
            // ${2:-<else>}
            let elseValue = this._until(4 /* CurlyClose */);
            if (elseValue) {
                parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue));
                return true;
            }
        }
        else if (this._accept(13 /* QuestionMark */)) {
            // ${2:?<if>:<else>}
            let ifValue = this._until(1 /* Colon */);
            if (ifValue) {
                let elseValue = this._until(4 /* CurlyClose */);
                if (elseValue) {
                    parent.appendChild(new FormatString(Number(index), undefined, ifValue, elseValue));
                    return true;
                }
            }
        }
        else {
            // ${1:<else>}
            let elseValue = this._until(4 /* CurlyClose */);
            if (elseValue) {
                parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue));
                return true;
            }
        }
        this._backTo(token);
        return false;
    }
    _parseAnything(marker) {
        if (this._token.type !== 14 /* EOF */) {
            marker.appendChild(new Text(this._scanner.tokenText(this._token)));
            this._accept(undefined);
            return true;
        }
        return false;
    }
}
exports.SnippetParser = SnippetParser;
//# sourceMappingURL=parser.js.map