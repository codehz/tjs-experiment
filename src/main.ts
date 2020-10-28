import { log } from "builtin:io";
import { request } from "./web";
import { decode } from "builtin:utf8";
import { decodePack, encodeGitCommand, parseGit } from "./git";

log(import.meta.main);

const ret = request({
  url: "https://github.com/codehz/tjs/info/refs?service=git-upload-pack",
  useragent: "git/0",
});

log(decode(new Uint8Array(ret).buffer));

const parsed = parseGit(ret);

log(JSON.stringify(parsed, null, 2));

const postret = request({
  method: "POST",
  url: "https://github.com/codehz/tjs/git-upload-pack",
  useragent: "git/0",
  data: encodeGitCommand([
    "want fa7ba08ccbff3eb643ffd4b5ba497ddbe5b46d6b filter shallow",
    "deepen 1",
    "filter tree:0",
    "",
    "done"
  ]),
})

log("length: ", postret.length);
log(JSON.stringify(decodePack(postret), null, 2));

function buf2hex(buffer: ArrayLike<number>) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
}

