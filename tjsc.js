#!/usr/bin/env node
"use strict";
const ts = require("typescript");
function hook(fn, name) {
    return (path, ...args) => {
        path = path.replace(/\.js$/, '.tjs');
        return fn(path, ...args);
    }
}
function doHook(root, attr) {
    if (root[attr])
        root[attr] = hook(root[attr], attr);
    else
        console.warn("undefined to ", attr);
}
doHook(ts.sys, "readFile");
doHook(ts.sys, "writeFile");
doHook(ts.sys, "resolvePath");
doHook(ts.sys, "fileExists");
doHook(ts.sys, "getModifiedTime");
doHook(ts.sys, "setModifiedTime");
doHook(ts.sys, "deleteFile");
doHook(ts.sys, "createHash");
doHook(ts.sys, "createSHA256Hash");
doHook(ts.sys, "realpath");

let args = process.argv.slice(2);
let watch = false;

if (args[0] == "--watch") {
    watch = true;
    args = args.slice(1);
}

if (watch) {
    const host = ts.createSolutionBuilderWithWatchHost(ts.sys);
    const builder = ts.createSolutionBuilderWithWatch(host, ["."], {});
    builder.build();
} else {
    const host = ts.createSolutionBuilderHost(ts.sys);
    const builder = ts.createSolutionBuilder(host, ["."], {});
    builder.build();
}

