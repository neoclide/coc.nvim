"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const semver = require("semver");
class API {
    constructor(versionString, version) {
        this.versionString = versionString;
        this.version = version;
    }
    static fromVersionString(versionString) {
        let version = semver.valid(versionString);
        if (!version) {
            return new API('invalid version', '1.0.0');
        }
        // Cut off any prerelease tag since we sometimes consume those on purpose.
        const index = versionString.indexOf('-');
        if (index >= 0) {
            version = version.substr(0, index);
        }
        return new API(versionString, version);
    }
    has203Features() {
        return semver.gte(this.version, '2.0.3');
    }
    has206Features() {
        return semver.gte(this.version, '2.0.6');
    }
    has208Features() {
        return semver.gte(this.version, '2.0.8');
    }
    has213Features() {
        return semver.gte(this.version, '2.1.3');
    }
    has220Features() {
        return semver.gte(this.version, '2.2.0');
    }
    has222Features() {
        return semver.gte(this.version, '2.2.2');
    }
    has230Features() {
        return semver.gte(this.version, '2.3.0');
    }
    has234Features() {
        return semver.gte(this.version, '2.3.4');
    }
    has240Features() {
        return semver.gte(this.version, '2.4.0');
    }
    has250Features() {
        return semver.gte(this.version, '2.5.0');
    }
    has260Features() {
        return semver.gte(this.version, '2.6.0');
    }
    has262Features() {
        return semver.gte(this.version, '2.6.2');
    }
    has270Features() {
        return semver.gte(this.version, '2.7.0');
    }
    has280Features() {
        return semver.gte(this.version, '2.8.0');
    }
    has290Features() {
        return semver.gte(this.version, '2.9.0');
    }
}
API.defaultVersion = new API('1.0.0', '1.0.0');
exports.default = API;
//# sourceMappingURL=api.js.map