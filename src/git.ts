import { log } from "builtin:io";
import { decode, encode } from "builtin:utf8";
import { inflate } from "./zlib";

export function encodeGitCommand(data: string[]) {
  let ret = "";
  for (const item of data) {
    if (item.length) {
      const line = item + "\n"
      ret += (line.length + 4).toString(16).padStart(4, "0");
      ret += line;
    } else {
      ret += "0000";
    }
  }
  return encode(ret);
}

export function gitSplit(buffer: Uint8Array) {
  let len = Number.parseInt(decode(buffer.slice(0, 4).buffer), 16);
  const arr: Uint8Array[] = [];
  while (len && buffer.length) {
    const tmp = buffer.slice(4, len);
    arr.push(tmp);
    buffer = buffer.slice(len);
    len = Number.parseInt(decode(buffer.slice(0, 4).buffer), 16);
    if (len == 0) len = 4;
  }
  return arr;
}

function skipJunk(buffer: Uint8Array) {
  let len = Number.parseInt(decode(buffer.slice(0, 4).buffer), 16);
  while (len && buffer.length) {
    buffer = buffer.slice(len);
    len = Number.parseInt(decode(buffer.slice(0, 4).buffer), 16);
    if (len == 0) len = 4;
    else if (Number.isNaN(len)) {
      return buffer;
    }
  }
  return null;
}

function packObjectTypeName(t: number) {
  switch (t) {
    case 1: return "commit";
    case 2: return "tree";
    case 3: return "blob";
    case 4: return "tag";
    case 6: return "ofs_delta";
    case 7: return "ref_delta";
    default: throw new Error("Invalid type " + t);
  }
}

export function decodePack(buffer: Uint8Array) {
  const data = skipJunk(buffer);
  if (!data) return null;
  if (decode(data.slice(0, 4).buffer) != "PACK") return null;
  const view = new DataView(data.buffer);
  const version = view.getUint32(4, false);
  const count = view.getUint32(8, false);
  const objs = [];
  let p = 12;
  for (let i = 0; i < count; i++) {
    let c = view.getUint8(p++);
    const type = packObjectTypeName((c & 112) >> 4);
    let size = c & 15;
    let shift = 4;
    while (c & 0x80) {
      c = view.getUint8(p++);
      size += (c & 0x7F) << shift;
      shift += 7;
    }
    const cache = new Uint8Array(size);
    const xsize = inflate(cache.buffer, data.slice(p).buffer);
    p += xsize;
    if (type == "commit")
      objs[i] = {
        type,
        size,
        cache: decode(cache.buffer).split('\n')
      };
    else
      objs[i] = {
        type,
        size,
        cache: decodeTree(cache)
      };
  }
  return {
    version,
    count,
    objs
  }
}

function decodeTree(buffer: Uint8Array) {
  const arr = [];
  enum State {
    mode, name
  }
  let state: State = State.mode;
  let tmp = 0;
  let mode = 0;
  let name = "";
  for (let i = 0; i < buffer.length; i++) {
    // log("state: ", state, " ", i, ": ", String.fromCharCode(buffer[i]));
    switch (state) {
      case State.mode:
        if (buffer[i] == 32) {
          mode = parseInt(decode(buffer.slice(tmp, i).buffer), 8);
          tmp = i + 1;
          state = State.name;
        }
        break;
      case State.name:
        if (buffer[i] == 0) {
          name = decode(buffer.slice(tmp, i).buffer);
          arr.push({
            mode,
            name,
            sha1: buf2hex(buffer.slice(i + 1, i + 21))
          });
          tmp = i + 21;
          i += 21;
          state = State.mode;
        }
    }
  }
  return arr;
}

function buf2hex(buffer: ArrayLike<number>) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
}

export function parseGit(buffer: Uint8Array) {
  const data = gitSplit(buffer);
  const refs = data.slice(3, -1)
    .map(x => decode(x.buffer).trim().split(' ', 2))
    .reduce((o, [a, b]) => Object.assign({}, o, { [b]: a }), {});
  const [xhead, featureslist] = decode(data[2].buffer).split('\0');
  const headhash = xhead.split(' ', 2)[0];
  const features = featureslist
    .split(' ')
    .reduce((o, a) => {
      const s = a.split('=', 2)
      if (s.length == 2) {
        return Object.assign({}, o, { [s[0]]: s[1] });
      } else {
        return Object.assign({}, o, { [s[0]]: true });
      }
    }, {});
  return {
    HEAD: headhash,
    features,
    refs
  };
}