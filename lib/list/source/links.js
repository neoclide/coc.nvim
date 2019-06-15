"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const path_1 = tslib_1.__importDefault(require("path"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const vscode_uri_1 = require("vscode-uri");
const fs_1 = require("../../util/fs");
class LinksList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'open';
        this.description = 'links of current buffer';
        this.name = 'links';
        this.addAction('open', async (item) => {
            let { target } = item.data;
            let uri = vscode_uri_1.URI.parse(target);
            if (uri.scheme.startsWith('http')) {
                await nvim.call('coc#util#open_url', target);
            }
            else {
                await workspace_1.default.jumpTo(target);
            }
        });
        this.addAction('jump', async (item) => {
            let { location } = item.data;
            await workspace_1.default.jumpTo(location.uri, location.range.start);
        });
    }
    async loadItems(context) {
        let buf = await context.window.buffer;
        let doc = workspace_1.default.getDocument(buf.id);
        if (!doc)
            return null;
        let items = [];
        let links = await languages_1.default.getDocumentLinks(doc.textDocument);
        if (links == null) {
            throw new Error('Links provider not found.');
        }
        let res = [];
        for (let link of links) {
            if (link.target) {
                items.push({
                    label: formatUri(link.target),
                    data: {
                        target: link.target,
                        location: vscode_languageserver_types_1.Location.create(doc.uri, link.range)
                    }
                });
            }
            else {
                link = await languages_1.default.resolveDocumentLink(link);
                if (link.target) {
                    items.push({
                        label: formatUri(link.target),
                        data: {
                            target: link.target,
                            location: vscode_languageserver_types_1.Location.create(doc.uri, link.range)
                        }
                    });
                }
                res.push(link);
            }
        }
        return items;
    }
}
exports.default = LinksList;
function formatUri(uri) {
    if (!uri.startsWith('file:'))
        return uri;
    let filepath = vscode_uri_1.URI.parse(uri).fsPath;
    return fs_1.isParentFolder(workspace_1.default.cwd, filepath) ? path_1.default.relative(workspace_1.default.cwd, filepath) : filepath;
}
//# sourceMappingURL=links.js.map