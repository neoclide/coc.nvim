"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* tslint:disable */
const assert = tslib_1.__importStar(require("assert"));
const parser_1 = require("../../snippets/parser");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
describe('SnippetParser', () => {
    test('Scanner', () => {
        const scanner = new parser_1.Scanner();
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('abc');
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('{{abc}}');
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('abc() ');
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 10 /* Format */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('abc 123');
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 10 /* Format */);
        assert.equal(scanner.next().type, 8 /* Int */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('$foo');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('$foo_bar');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('$foo-bar');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 12 /* Dash */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('${foo}');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('${1223:foo}');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 8 /* Int */);
        assert.equal(scanner.next().type, 1 /* Colon */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        assert.equal(scanner.next().type, 14 /* EOF */);
        scanner.text('\\${}');
        assert.equal(scanner.next().type, 5 /* Backslash */);
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        scanner.text('${foo/regex/format/option}');
        assert.equal(scanner.next().type, 0 /* Dollar */);
        assert.equal(scanner.next().type, 3 /* CurlyOpen */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 6 /* Forwardslash */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 6 /* Forwardslash */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 6 /* Forwardslash */);
        assert.equal(scanner.next().type, 9 /* VariableName */);
        assert.equal(scanner.next().type, 4 /* CurlyClose */);
        assert.equal(scanner.next().type, 14 /* EOF */);
    });
    function assertText(value, expected) {
        const p = new parser_1.SnippetParser();
        const actual = p.text(value);
        assert.equal(actual, expected);
    }
    function assertMarker(input, ...ctors) {
        let marker;
        if (input instanceof parser_1.TextmateSnippet) {
            marker = input.children;
        }
        else if (typeof input === 'string') {
            const p = new parser_1.SnippetParser();
            marker = p.parse(input).children;
        }
        else {
            marker = input;
        }
        while (marker.length > 0) {
            let m = marker.pop();
            let ctor = ctors.pop();
            assert.ok(m instanceof ctor);
        }
        assert.equal(marker.length, ctors.length);
        assert.equal(marker.length, 0);
    }
    function assertTextAndMarker(value, escaped, ...ctors) {
        assertText(value, escaped);
        assertMarker(value, ...ctors);
    }
    function assertEscaped(value, expected) {
        const actual = parser_1.SnippetParser.escape(value);
        assert.equal(actual, expected);
    }
    test('Parser, escaped', function () {
        assertEscaped('foo$0', 'foo\\$0');
        assertEscaped('foo\\$0', 'foo\\\\\\$0');
        assertEscaped('f$1oo$0', 'f\\$1oo\\$0');
        assertEscaped('${1:foo}$0', '\\${1:foo\\}\\$0');
        assertEscaped('$', '\\$');
    });
    test('Parser, text', () => {
        assertText('$', '$');
        assertText('\\\\$', '\\$');
        assertText('{', '{');
        assertText('\\}', '}');
        assertText('\\abc', '\\abc');
        assertText('foo${f:\\}}bar', 'foo}bar');
        assertText('\\{', '\\{');
        assertText('I need \\\\\\$', 'I need \\$');
        assertText('\\', '\\');
        assertText('\\{{', '\\{{');
        assertText('{{', '{{');
        assertText('{{dd', '{{dd');
        assertText('}}', '}}');
        assertText('ff}}', 'ff}}');
        assertText('farboo', 'farboo');
        assertText('far{{}}boo', 'far{{}}boo');
        assertText('far{{123}}boo', 'far{{123}}boo');
        assertText('far\\{{123}}boo', 'far\\{{123}}boo');
        assertText('far{{id:bern}}boo', 'far{{id:bern}}boo');
        assertText('far{{id:bern {{basel}}}}boo', 'far{{id:bern {{basel}}}}boo');
        assertText('far{{id:bern {{id:basel}}}}boo', 'far{{id:bern {{id:basel}}}}boo');
        assertText('far{{id:bern {{id2:basel}}}}boo', 'far{{id:bern {{id2:basel}}}}boo');
    });
    test('Parser, TM text', () => {
        assertTextAndMarker('foo${1:bar}}', 'foobar}', parser_1.Text, parser_1.Placeholder, parser_1.Text);
        assertTextAndMarker('foo${1:bar}${2:foo}}', 'foobarfoo}', parser_1.Text, parser_1.Placeholder, parser_1.Placeholder, parser_1.Text);
        assertTextAndMarker('foo${1:bar\\}${2:foo}}', 'foobar}foo', parser_1.Text, parser_1.Placeholder);
        let [, placeholder] = new parser_1.SnippetParser().parse('foo${1:bar\\}${2:foo}}').children;
        let { children } = placeholder;
        assert.equal(placeholder.index, '1');
        assert.ok(children[0] instanceof parser_1.Text);
        assert.equal(children[0].toString(), 'bar}');
        assert.ok(children[1] instanceof parser_1.Placeholder);
        assert.equal(children[1].toString(), 'foo');
    });
    test('Parser, placeholder', () => {
        assertTextAndMarker('farboo', 'farboo', parser_1.Text);
        assertTextAndMarker('far{{}}boo', 'far{{}}boo', parser_1.Text);
        assertTextAndMarker('far{{123}}boo', 'far{{123}}boo', parser_1.Text);
        assertTextAndMarker('far\\{{123}}boo', 'far\\{{123}}boo', parser_1.Text);
    });
    test('Parser, literal code', () => {
        assertTextAndMarker('far`123`boo', 'far`123`boo', parser_1.Text);
        assertTextAndMarker('far\\`123\\`boo', 'far\\`123\\`boo', parser_1.Text);
    });
    test('Parser, variables/tabstop', () => {
        assertTextAndMarker('$far-boo', '-boo', parser_1.Variable, parser_1.Text);
        assertTextAndMarker('\\$far-boo', '$far-boo', parser_1.Text);
        assertTextAndMarker('far$farboo', 'far', parser_1.Text, parser_1.Variable);
        assertTextAndMarker('far${farboo}', 'far', parser_1.Text, parser_1.Variable);
        assertTextAndMarker('$123', '', parser_1.Placeholder);
        assertTextAndMarker('$farboo', '', parser_1.Variable);
        assertTextAndMarker('$far12boo', '', parser_1.Variable);
        assertTextAndMarker('000_${far}_000', '000__000', parser_1.Text, parser_1.Variable, parser_1.Text);
        assertTextAndMarker('FFF_${TM_SELECTED_TEXT}_FFF$0', 'FFF__FFF', parser_1.Text, parser_1.Variable, parser_1.Text, parser_1.Placeholder);
    });
    test('Parser, variables/placeholder with defaults', () => {
        assertTextAndMarker('${name:value}', 'value', parser_1.Variable);
        assertTextAndMarker('${1:value}', 'value', parser_1.Placeholder);
        assertTextAndMarker('${1:bar${2:foo}bar}', 'barfoobar', parser_1.Placeholder);
        assertTextAndMarker('${name:value', '${name:value', parser_1.Text);
        assertTextAndMarker('${1:bar${2:foobar}', '${1:barfoobar', parser_1.Text, parser_1.Placeholder);
    });
    test('Parser, variable transforms', function () {
        assertTextAndMarker('${foo///}', '', parser_1.Variable);
        assertTextAndMarker('${foo/regex/format/gmi}', '', parser_1.Variable);
        assertTextAndMarker('${foo/([A-Z][a-z])/format/}', '', parser_1.Variable);
        // invalid regex
        assertTextAndMarker('${foo/([A-Z][a-z])/format/GMI}', '${foo/([A-Z][a-z])/format/GMI}', parser_1.Text);
        assertTextAndMarker('${foo/([A-Z][a-z])/format/funky}', '${foo/([A-Z][a-z])/format/funky}', parser_1.Text);
        assertTextAndMarker('${foo/([A-Z][a-z]/format/}', '${foo/([A-Z][a-z]/format/}', parser_1.Text);
        // tricky regex
        assertTextAndMarker('${foo/m\\/atch/$1/i}', '', parser_1.Variable);
        assertMarker('${foo/regex\/format/options}', parser_1.Text);
        // incomplete
        assertTextAndMarker('${foo///', '${foo///', parser_1.Text);
        assertTextAndMarker('${foo/regex/format/options', '${foo/regex/format/options', parser_1.Text);
        // format string
        assertMarker('${foo/.*/${0:fooo}/i}', parser_1.Variable);
        assertMarker('${foo/.*/${1}/i}', parser_1.Variable);
        assertMarker('${foo/.*/$1/i}', parser_1.Variable);
        assertMarker('${foo/.*/This-$1-encloses/i}', parser_1.Variable);
        assertMarker('${foo/.*/complex${1:else}/i}', parser_1.Variable);
        assertMarker('${foo/.*/complex${1:-else}/i}', parser_1.Variable);
        assertMarker('${foo/.*/complex${1:+if}/i}', parser_1.Variable);
        assertMarker('${foo/.*/complex${1:?if:else}/i}', parser_1.Variable);
        assertMarker('${foo/.*/complex${1:/upcase}/i}', parser_1.Variable);
    });
    test('Parser, placeholder with transform', () => {
        const p = new parser_1.SnippetParser();
        const snippet = p.parse('${1:type}${1/(.+)/ /}');
        let s = snippet.toString();
        assert.equal(s.length, 5);
    });
    test('Parser, placeholder transforms', function () {
        assertTextAndMarker('${1///}', '', parser_1.Placeholder);
        assertTextAndMarker('${1/regex/format/gmi}', '', parser_1.Placeholder);
        assertTextAndMarker('${1/([A-Z][a-z])/format/}', '', parser_1.Placeholder);
        assertTextAndMarker('${1///}', '', parser_1.Placeholder);
        // tricky regex
        assertTextAndMarker('${1/m\\/atch/$1/i}', '', parser_1.Placeholder);
        assertMarker('${1/regex\/format/options}', parser_1.Text);
        // incomplete
        assertTextAndMarker('${1///', '${1///', parser_1.Text);
        assertTextAndMarker('${1/regex/format/options', '${1/regex/format/options', parser_1.Text);
    });
    test('No way to escape forward slash in snippet regex #36715', function () {
        assertMarker('${TM_DIRECTORY/src\\//$1/}', parser_1.Variable);
    });
    test('No way to escape forward slash in snippet format section #37562', function () {
        assertMarker('${TM_SELECTED_TEXT/a/\\/$1/g}', parser_1.Variable);
        assertMarker('${TM_SELECTED_TEXT/a/in\\/$1ner/g}', parser_1.Variable);
        assertMarker('${TM_SELECTED_TEXT/a/end\\//g}', parser_1.Variable);
    });
    test('Parser, placeholder with choice', () => {
        assertTextAndMarker('${1|one,two,three|}', 'one', parser_1.Placeholder);
        assertTextAndMarker('${1|one|}', 'one', parser_1.Placeholder);
        assertTextAndMarker('${1|one1,two2|}', 'one1', parser_1.Placeholder);
        assertTextAndMarker('${1|one1\\,two2|}', 'one1,two2', parser_1.Placeholder);
        assertTextAndMarker('${1|one1\\|two2|}', 'one1|two2', parser_1.Placeholder);
        assertTextAndMarker('${1|one1\\atwo2|}', 'one1\\atwo2', parser_1.Placeholder);
        assertTextAndMarker('${1|one,two,three,|}', '${1|one,two,three,|}', parser_1.Text);
        assertTextAndMarker('${1|one,', '${1|one,', parser_1.Text);
        const p = new parser_1.SnippetParser();
        const snippet = p.parse('${1|one,two,three|}');
        assertMarker(snippet, parser_1.Placeholder);
        const expected = [parser_1.Placeholder, parser_1.Text, parser_1.Text, parser_1.Text];
        snippet.walk(marker => {
            assert.equal(marker, expected.shift());
            return true;
        });
    });
    test('Snippet choices: unable to escape comma and pipe, #31521', function () {
        assertTextAndMarker('console.log(${1|not\\, not, five, 5, 1   23|});', 'console.log(not, not);', parser_1.Text, parser_1.Placeholder, parser_1.Text);
    });
    test('Marker, toTextmateString()', function () {
        function assertTextsnippetString(input, expected) {
            const snippet = new parser_1.SnippetParser().parse(input);
            const actual = snippet.toTextmateString();
            assert.equal(actual, expected);
        }
        assertTextsnippetString('$1', '$1');
        assertTextsnippetString('\\$1', '\\$1');
        assertTextsnippetString('console.log(${1|not\\, not, five, 5, 1   23|});', 'console.log(${1|not\\, not, five, 5, 1   23|});');
        assertTextsnippetString('console.log(${1|not\\, not, \\| five, 5, 1   23|});', 'console.log(${1|not\\, not, \\| five, 5, 1   23|});');
        assertTextsnippetString('this is text', 'this is text');
        assertTextsnippetString('this ${1:is ${2:nested with $var}}', 'this ${1:is ${2:nested with ${var}}}');
        assertTextsnippetString('this ${1:is ${2:nested with $var}}}', 'this ${1:is ${2:nested with ${var}}}\\}');
    });
    test('Marker, toTextmateString() <-> identity', function () {
        function assertIdent(input) {
            // full loop: (1) parse input, (2) generate textmate string, (3) parse, (4) ensure both trees are equal
            const snippet = new parser_1.SnippetParser().parse(input);
            const input2 = snippet.toTextmateString();
            const snippet2 = new parser_1.SnippetParser().parse(input2);
            function checkCheckChildren(marker1, marker2) {
                assert.ok(marker1 instanceof Object.getPrototypeOf(marker2).constructor);
                assert.ok(marker2 instanceof Object.getPrototypeOf(marker1).constructor);
                assert.equal(marker1.children.length, marker2.children.length);
                assert.equal(marker1.toString(), marker2.toString());
                for (let i = 0; i < marker1.children.length; i++) {
                    checkCheckChildren(marker1.children[i], marker2.children[i]);
                }
            }
            checkCheckChildren(snippet, snippet2);
        }
        assertIdent('$1');
        assertIdent('\\$1');
        assertIdent('console.log(${1|not\\, not, five, 5, 1   23|});');
        assertIdent('console.log(${1|not\\, not, \\| five, 5, 1   23|});');
        assertIdent('this is text');
        assertIdent('this ${1:is ${2:nested with $var}}');
        assertIdent('this ${1:is ${2:nested with $var}}}');
        assertIdent('this ${1:is ${2:nested with $var}} and repeating $1');
    });
    test('Parser, choise marker', () => {
        const { placeholders } = new parser_1.SnippetParser().parse('${1|one,two,three|}');
        assert.equal(placeholders.length, 1);
        assert.ok(placeholders[0].choice instanceof parser_1.Choice);
        assert.ok(placeholders[0].children[0] instanceof parser_1.Choice);
        assert.equal(placeholders[0].children[0].options.length, 3);
        assertText('${1|one,two,three|}', 'one');
        assertText('\\${1|one,two,three|}', '${1|one,two,three|}');
        assertText('${1\\|one,two,three|}', '${1\\|one,two,three|}');
        assertText('${1||}', '${1||}');
    });
    test('Backslash character escape in choice tabstop doesn\'t work #58494', function () {
        const { placeholders } = new parser_1.SnippetParser().parse('${1|\\,,},$,\\|,\\\\|}');
        assert.equal(placeholders.length, 1);
        assert.ok(placeholders[0].choice instanceof parser_1.Choice);
    });
    test('Parser, only textmate', () => {
        const p = new parser_1.SnippetParser();
        assertMarker(p.parse('far{{}}boo'), parser_1.Text);
        assertMarker(p.parse('far{{123}}boo'), parser_1.Text);
        assertMarker(p.parse('far\\{{123}}boo'), parser_1.Text);
        assertMarker(p.parse('far$0boo'), parser_1.Text, parser_1.Placeholder, parser_1.Text);
        assertMarker(p.parse('far${123}boo'), parser_1.Text, parser_1.Placeholder, parser_1.Text);
        assertMarker(p.parse('far\\${123}boo'), parser_1.Text);
    });
    test('Parser, real world', () => {
        let marker = new parser_1.SnippetParser().parse('console.warn(${1: $TM_SELECTED_TEXT })').children;
        assert.equal(marker[0].toString(), 'console.warn(');
        assert.ok(marker[1] instanceof parser_1.Placeholder);
        assert.equal(marker[2].toString(), ')');
        const placeholder = marker[1];
        assert.equal(placeholder, false);
        assert.equal(placeholder.index, '1');
        assert.equal(placeholder.children.length, 3);
        assert.ok(placeholder.children[0] instanceof parser_1.Text);
        assert.ok(placeholder.children[1] instanceof parser_1.Variable);
        assert.ok(placeholder.children[2] instanceof parser_1.Text);
        assert.equal(placeholder.children[0].toString(), ' ');
        assert.equal(placeholder.children[1].toString(), '');
        assert.equal(placeholder.children[2].toString(), ' ');
        const nestedVariable = placeholder.children[1];
        assert.equal(nestedVariable.name, 'TM_SELECTED_TEXT');
        assert.equal(nestedVariable.children.length, 0);
        marker = new parser_1.SnippetParser().parse('$TM_SELECTED_TEXT').children;
        assert.equal(marker.length, 1);
        assert.ok(marker[0] instanceof parser_1.Variable);
    });
    test('Parser, transform example', () => {
        let { children } = new parser_1.SnippetParser().parse('${1:name} : ${2:type}${3/\\s:=(.*)/${1:+ :=}${1}/};\n$0');
        //${1:name}
        assert.ok(children[0] instanceof parser_1.Placeholder);
        assert.equal(children[0].children.length, 1);
        assert.equal(children[0].children[0].toString(), 'name');
        assert.equal(children[0].transform, undefined);
        // :
        assert.ok(children[1] instanceof parser_1.Text);
        assert.equal(children[1].toString(), ' : ');
        //${2:type}
        assert.ok(children[2] instanceof parser_1.Placeholder);
        assert.equal(children[2].children.length, 1);
        assert.equal(children[2].children[0].toString(), 'type');
        //${3/\\s:=(.*)/${1:+ :=}${1}/}
        assert.ok(children[3] instanceof parser_1.Placeholder);
        assert.equal(children[3].children.length, 0);
        assert.notEqual(children[3].transform, undefined);
        let transform = children[3].transform;
        assert.equal(transform.regexp, '/\\s:=(.*)/');
        assert.equal(transform.children.length, 2);
        assert.ok(transform.children[0] instanceof parser_1.FormatString);
        assert.equal(transform.children[0].index, 1);
        assert.equal(transform.children[0].ifValue, ' :=');
        assert.ok(transform.children[1] instanceof parser_1.FormatString);
        assert.equal(transform.children[1].index, 1);
        assert.ok(children[4] instanceof parser_1.Text);
        assert.equal(children[4].toString(), ';\n');
    });
    test('Parser, default placeholder values', () => {
        assertMarker('errorContext: `${1:err}`, error: $1', parser_1.Text, parser_1.Placeholder, parser_1.Text, parser_1.Placeholder);
        const [, p1, , p2] = new parser_1.SnippetParser().parse('errorContext: `${1:err}`, error:$1').children;
        assert.equal(p1.index, '1');
        assert.equal(p1.children.length, '1');
        assert.equal(p1.children[0], 'err');
        assert.equal(p2.index, '1');
        assert.equal(p2.children.length, '1');
        assert.equal(p2.children[0], 'err');
    });
    test('Parser, default placeholder values and one transform', () => {
        assertMarker('errorContext: `${1:err}`, error: ${1/err/ok/}', parser_1.Text, parser_1.Placeholder, parser_1.Text, parser_1.Placeholder);
        const [, p3, , p4] = new parser_1.SnippetParser().parse('errorContext: `${1:err}`, error:${1/err/ok/}').children;
        assert.equal(p3.index, '1');
        assert.equal(p3.children.length, '1');
        assert.equal(p3.children[0], 'err');
        assert.equal(p3.transform, undefined);
        assert.equal(p4.index, '1');
        assert.equal(p4.children.length, '1');
        assert.equal(p4.children[0], 'ok');
        assert.notEqual(p4.transform, undefined);
    });
    test('Repeated snippet placeholder should always inherit, #31040', function () {
        assertText('${1:foo}-abc-$1', 'foo-abc-foo');
        assertText('${1:foo}-abc-${1}', 'foo-abc-foo');
        assertText('${1:foo}-abc-${1:bar}', 'foo-abc-foo');
        assertText('${1}-abc-${1:foo}', 'foo-abc-foo');
    });
    test('backspace esapce in TM only, #16212', () => {
        const actual = new parser_1.SnippetParser().text('Foo \\\\${abc}bar');
        assert.equal(actual, 'Foo \\bar');
    });
    test('colon as variable/placeholder value, #16717', () => {
        let actual = new parser_1.SnippetParser().text('${TM_SELECTED_TEXT:foo:bar}');
        assert.equal(actual, 'foo:bar');
        actual = new parser_1.SnippetParser().text('${1:foo:bar}');
        assert.equal(actual, 'foo:bar');
    });
    test('incomplete placeholder', () => {
        assertTextAndMarker('${1:}', '', parser_1.Placeholder);
    });
    test('marker#len', () => {
        function assertLen(template, ...lengths) {
            const snippet = new parser_1.SnippetParser().parse(template, true);
            snippet.walk(m => {
                const expected = lengths.shift();
                assert.equal(m.len(), expected);
                return true;
            });
            assert.equal(lengths.length, 0);
        }
        assertLen('text$0', 4, 0);
        assertLen('$1text$0', 0, 4, 0);
        assertLen('te$1xt$0', 2, 0, 2, 0);
        assertLen('errorContext: `${1:err}`, error: $0', 15, 0, 3, 10, 0);
        assertLen('errorContext: `${1:err}`, error: $1$0', 15, 0, 3, 10, 0, 3, 0);
        assertLen('$TM_SELECTED_TEXT$0', 0, 0);
        assertLen('${TM_SELECTED_TEXT:def}$0', 0, 3, 0);
    });
    test('parser, parent node', function () {
        let snippet = new parser_1.SnippetParser().parse('This ${1:is ${2:nested}}$0', true);
        assert.equal(snippet.placeholders.length, 3);
        let [first, second] = snippet.placeholders;
        assert.equal(first.index, '1');
        assert.equal(second.index, '2');
        assert.ok(second.parent === first);
        assert.ok(first.parent === snippet);
        snippet = new parser_1.SnippetParser().parse('${VAR:default${1:value}}$0', true);
        assert.equal(snippet.placeholders.length, 2);
        [first] = snippet.placeholders;
        assert.equal(first.index, '1');
        assert.ok(snippet.children[0] instanceof parser_1.Variable);
        assert.ok(first.parent === snippet.children[0]);
    });
    test('TextmateSnippet#enclosingPlaceholders', () => {
        let snippet = new parser_1.SnippetParser().parse('This ${1:is ${2:nested}}$0', true);
        let [first, second] = snippet.placeholders;
        assert.deepEqual(snippet.enclosingPlaceholders(first), []);
        assert.deepEqual(snippet.enclosingPlaceholders(second), [first]);
    });
    test('TextmateSnippet#offset', () => {
        let snippet = new parser_1.SnippetParser().parse('te$1xt', true);
        assert.equal(snippet.offset(snippet.children[0]), 0);
        assert.equal(snippet.offset(snippet.children[1]), 2);
        assert.equal(snippet.offset(snippet.children[2]), 2);
        snippet = new parser_1.SnippetParser().parse('${TM_SELECTED_TEXT:def}', true);
        assert.equal(snippet.offset(snippet.children[0]), 0);
        assert.equal(snippet.offset(snippet.children[0].children[0]), 0);
        // forgein marker
        assert.equal(snippet.offset(new parser_1.Text('foo')), -1);
    });
    test('TextmateSnippet#placeholder', () => {
        let snippet = new parser_1.SnippetParser().parse('te$1xt$0', true);
        let placeholders = snippet.placeholders;
        assert.equal(placeholders.length, 2);
        snippet = new parser_1.SnippetParser().parse('te$1xt$1$0', true);
        placeholders = snippet.placeholders;
        assert.equal(placeholders.length, 3);
        snippet = new parser_1.SnippetParser().parse('te$1xt$2$0', true);
        placeholders = snippet.placeholders;
        assert.equal(placeholders.length, 3);
        snippet = new parser_1.SnippetParser().parse('${1:bar${2:foo}bar}$0', true);
        placeholders = snippet.placeholders;
        assert.equal(placeholders.length, 3);
    });
    test('TextmateSnippet#replace 1/2', function () {
        let snippet = new parser_1.SnippetParser().parse('aaa${1:bbb${2:ccc}}$0', true);
        assert.equal(snippet.placeholders.length, 3);
        const [, second] = snippet.placeholders;
        assert.equal(second.index, '2');
        const enclosing = snippet.enclosingPlaceholders(second);
        assert.equal(enclosing.length, 1);
        assert.equal(enclosing[0].index, '1');
        let nested = new parser_1.SnippetParser().parse('ddd$1eee$0', true);
        snippet.replace(second, nested.children);
        assert.equal(snippet.toString(), 'aaabbbdddeee');
        assert.equal(snippet.placeholders.length, 4);
        assert.equal(snippet.placeholders[0].index, '1');
        assert.equal(snippet.placeholders[1].index, '1');
        assert.equal(snippet.placeholders[2].index, '0');
        assert.equal(snippet.placeholders[3].index, '0');
        const newEnclosing = snippet.enclosingPlaceholders(snippet.placeholders[1]);
        assert.ok(newEnclosing[0] === snippet.placeholders[0]);
        assert.equal(newEnclosing.length, 1);
        assert.equal(newEnclosing[0].index, '1');
    });
    test('TextmateSnippet#replace 2/2', function () {
        let snippet = new parser_1.SnippetParser().parse('aaa${1:bbb${2:ccc}}$0', true);
        assert.equal(snippet.placeholders.length, 3);
        const [, second] = snippet.placeholders;
        assert.equal(second.index, '2');
        let nested = new parser_1.SnippetParser().parse('dddeee$0', true);
        snippet.replace(second, nested.children);
        assert.equal(snippet.toString(), 'aaabbbdddeee');
        assert.equal(snippet.placeholders.length, 3);
    });
    test('TextmateSnippet#insertSnippet', function () {
        let snippet = new parser_1.SnippetParser().parse('${1:aaa} ${1:aaa} bbb ${2:ccc}}$0', true);
        snippet.insertSnippet('|${1:dd} ${2:ff}|', 1, vscode_languageserver_types_1.Range.create(0, 0, 0, 0));
        const [one, two, three] = snippet.placeholders;
        assert.equal(one.index, 1);
        assert.equal(one.toString(), 'aaa');
        assert.equal(two.index, 2);
        assert.equal(two.toString(), 'dd');
        assert.equal(three.index, 3);
        assert.equal(three.toString(), 'ff');
    });
    test('TextmateSnippet#updatePlaceholder', function () {
        let snippet = new parser_1.SnippetParser().parse('aaa${1:bbb} ${1:bbb}', true);
        snippet.updatePlaceholder(0, 'ccc');
        let p = snippet.placeholders[0];
        assert.equal(p.toString(), 'ccc');
    });
    test('Snippet order for placeholders, #28185', function () {
        const _10 = new parser_1.Placeholder(10);
        const _2 = new parser_1.Placeholder(2);
        assert.equal(parser_1.Placeholder.compareByIndex(_10, _2), 1);
    });
    test('Maximum call stack size exceeded, #28983', function () {
        new parser_1.SnippetParser().parse('${1:${foo:${1}}}');
    });
    test('Snippet can freeze the editor, #30407', function () {
        const seen = new Set();
        seen.clear();
        new parser_1.SnippetParser().parse('class ${1:${TM_FILENAME/(?:\\A|_)([A-Za-z0-9]+)(?:\\.rb)?/(?2::\\u$1)/g}} < ${2:Application}Controller\n  $3\nend').walk(marker => {
            assert.ok(!seen.has(marker));
            seen.add(marker);
            return true;
        });
        seen.clear();
        new parser_1.SnippetParser().parse('${1:${FOO:abc$1def}}').walk(marker => {
            assert.ok(!seen.has(marker));
            seen.add(marker);
            return true;
        });
    });
    test('Snippets: make parser ignore `${0|choice|}`, #31599', function () {
        assertTextAndMarker('${0|foo,bar|}', '${0|foo,bar|}', parser_1.Text);
        assertTextAndMarker('${1|foo,bar|}', 'foo', parser_1.Placeholder);
    });
    test('Transform -> FormatString#resolve', function () {
        // shorthand functions
        assert.equal(new parser_1.FormatString(1, 'upcase').resolve('foo'), 'FOO');
        assert.equal(new parser_1.FormatString(1, 'downcase').resolve('FOO'), 'foo');
        assert.equal(new parser_1.FormatString(1, 'capitalize').resolve('bar'), 'Bar');
        assert.equal(new parser_1.FormatString(1, 'capitalize').resolve('bar no repeat'), 'Bar no repeat');
        assert.equal(new parser_1.FormatString(1, 'pascalcase').resolve('bar-foo'), 'BarFoo');
        assert.equal(new parser_1.FormatString(1, 'notKnown').resolve('input'), 'input');
        // if
        assert.equal(new parser_1.FormatString(1, undefined, 'foo', undefined).resolve(undefined), '');
        assert.equal(new parser_1.FormatString(1, undefined, 'foo', undefined).resolve(''), '');
        assert.equal(new parser_1.FormatString(1, undefined, 'foo', undefined).resolve('bar'), 'foo');
        // else
        assert.equal(new parser_1.FormatString(1, undefined, undefined, 'foo').resolve(undefined), 'foo');
        assert.equal(new parser_1.FormatString(1, undefined, undefined, 'foo').resolve(''), 'foo');
        assert.equal(new parser_1.FormatString(1, undefined, undefined, 'foo').resolve('bar'), 'bar');
        // if-else
        assert.equal(new parser_1.FormatString(1, undefined, 'bar', 'foo').resolve(undefined), 'foo');
        assert.equal(new parser_1.FormatString(1, undefined, 'bar', 'foo').resolve(''), 'foo');
        assert.equal(new parser_1.FormatString(1, undefined, 'bar', 'foo').resolve('baz'), 'bar');
    });
    test('Snippet variable transformation doesn\'t work if regex is complicated and snippet body contains \'$$\' #55627', function () {
        const snippet = new parser_1.SnippetParser().parse('const fileName = "${TM_FILENAME/(.*)\\..+$/$1/}"');
        assert.equal(snippet.toTextmateString(), 'const fileName = "${TM_FILENAME/(.*)\\..+$/${1}/}"');
    });
    test('[BUG] HTML attribute suggestions: Snippet session does not have end-position set, #33147', function () {
        const { placeholders } = new parser_1.SnippetParser().parse('src="$1"', true);
        const [first, second] = placeholders;
        assert.equal(placeholders.length, 2);
        assert.equal(first.index, 1);
        assert.equal(second.index, 0);
    });
    test('Snippet optional transforms are not applied correctly when reusing the same variable, #37702', function () {
        const transform = new parser_1.Transform();
        transform.appendChild(new parser_1.FormatString(1, 'upcase'));
        transform.appendChild(new parser_1.FormatString(2, 'upcase'));
        transform.regexp = /^(.)|-(.)/g;
        assert.equal(transform.resolve('my-file-name'), 'MyFileName');
        const clone = transform.clone();
        assert.equal(clone.resolve('my-file-name'), 'MyFileName');
    });
    test('problem with snippets regex #40570', function () {
        const snippet = new parser_1.SnippetParser().parse('${TM_DIRECTORY/.*src[\\/](.*)/$1/}');
        assertMarker(snippet, parser_1.Variable);
    });
    test('Variable transformation doesn\'t work if undefined variables are used in the same snippet #51769', function () {
        let transform = new parser_1.Transform();
        transform.appendChild(new parser_1.Text('bar'));
        transform.regexp = new RegExp('foo', 'gi');
        assert.equal(transform.toTextmateString(), '/foo/bar/ig');
    });
    test('Snippet parser freeze #53144', function () {
        let snippet = new parser_1.SnippetParser().parse('${1/(void$)|(.+)/${1:?-\treturn nil;}/}');
        assertMarker(snippet, parser_1.Placeholder);
    });
    test('snippets variable not resolved in JSON proposal #52931', function () {
        assertTextAndMarker('FOO${1:/bin/bash}', 'FOO/bin/bash', parser_1.Text, parser_1.Placeholder);
    });
    test('Mirroring sequence of nested placeholders not selected properly on backjumping #58736', function () {
        let snippet = new parser_1.SnippetParser().parse('${3:nest1 ${1:nest2 ${2:nest3}}} $3');
        assert.equal(snippet.children.length, 3);
        assert.ok(snippet.children[0] instanceof parser_1.Placeholder);
        assert.ok(snippet.children[1] instanceof parser_1.Text);
        assert.ok(snippet.children[2] instanceof parser_1.Placeholder);
        function assertParent(marker) {
            marker.children.forEach(assertParent);
            if (!(marker instanceof parser_1.Placeholder)) {
                return;
            }
            let found = false;
            let m = marker;
            while (m && !found) {
                if (m.parent === snippet) {
                    found = true;
                }
                m = m.parent;
            }
            assert.ok(found);
        }
        let [, , clone] = snippet.children;
        assertParent(clone);
    });
});
//# sourceMappingURL=parser.test.js.map