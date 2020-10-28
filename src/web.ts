import { appendLibSearchPath, Compiler } from "builtin:c";
import { err, log, print } from "builtin:io";
import { decode } from "builtin:utf8";

const httpcompiler = new Compiler("memory");

const root = import.meta.url.substr(8).split('/').slice(0, -2).join('\\');
const curlroot = root + "\\vendor\\curl\\";
appendLibSearchPath(curlroot + "bin");
httpcompiler.include(curlroot + "include");
httpcompiler.linkDir(curlroot + "bin");
httpcompiler.link("curl");
httpcompiler.compile(String.raw`
#define __MINGW32__
#define UNICODE
#include <curl/curl.h>
#include <tjs.h>
#include <stdio.h>

void autofree(void **p) {
  free(*p);
}

void autocurl(CURL **p) {
  curl_easy_cleanup(*p);
}

size_t handler(void *data, size_t size, size_t nmemb, void *userp) {
  size_t realsize = size * nmemb;
  tjscallback *cb = userp;
  TJS_NOTIFY_DATA(*cb, 1, TJS_DATA_VECTOR2(data, realsize));
  return realsize;
}

#define new(T) malloc(sizeof(T))

typedef struct PostStreamState {
  char *buffer;
  size_t off, len, cap;
  BOOL done;
} PostStreamState;

#define PMIN(a, b) ((a) < (b) ? (a) : (b))
#define PMAX(a, b) ((a) > (b) ? (a) : (b))
#define PAGE_ROUND_DOWN(x) (((ULONG_PTR)(x)) & (~(4095)))
#define PAGE_ROUND_UP(x) ((((ULONG_PTR)(x)) + 4095) & (~(4095)))
#define STATE_REALLENGTH(state) ((state)->len - (state)->off)
#define STATE_REALPOINTER(state) ((state)->buffer + (state)->off)
#define STATE_REMAIN(state) ((state)->off + (state)->cap - (state)->len)

static inline PostStreamState *initPostStreamState(tjsvec_buf data) {
  PostStreamState *state = new(PostStreamState);
  state->off = 0;
  state->len = data.len;
  state->cap = PAGE_ROUND_UP(data.len);
  state->buffer = malloc(state->cap);
  memcpy(state->buffer, data.ptr, data.len);
  state->done = false;
  return state;
}

static inline void writePostStreamState(PostStreamState *state, tjsvec_buf data) {
  if (state->buffer && STATE_REMAIN(state) > data.len) {
    memmove(state->buffer, STATE_REALPOINTER(state), STATE_REALLENGTH(state));
    memcpy(state->buffer + STATE_REALLENGTH(state), data.ptr, data.len);
    state->len = STATE_REALLENGTH(state) + data.len;
    state->off = 0;
  } else {
    state->cap = PAGE_ROUND_UP(STATE_REALLENGTH(state) + data.len);
    state->buffer = realloc(state->buffer, state->cap);
    memmove(state->buffer, STATE_REALPOINTER(state), STATE_REALLENGTH(state));
    memcpy(state->buffer + STATE_REALLENGTH(state), data.ptr, data.len);
    state->len = STATE_REALLENGTH(state) + data.len;
    state->off = 0;
  }
}

static inline size_t readPostStreamState(PostStreamState *state, void *dest, size_t len) {
  size_t copied = PMIN(len, STATE_REALLENGTH(state));
  printf("%d %d copy %d\n", len, STATE_REALLENGTH(state), copied);
  if (copied) {
    memcpy(dest, STATE_REALPOINTER(state), copied);
    state->off += copied;
    return copied;
  } else if (state->done) {
    return 0;
  } else {
    return CURL_READFUNC_PAUSE;
  }
}

size_t xpostread(char *buffer, size_t size, size_t nitems, void *userdata) {
  CURL *curl = userdata;
  PostStreamState *state;
  curl_easy_getinfo(curl, CURLINFO_PRIVATE, &state);
  printf("xpostread: %p\n", state);
  size_t ret = readPostStreamState(state, buffer, size * nitems);
  printf("ret: %d\n", ret);
  return ret;
}

void xpost(CURL* curl, tjsvec_buf data) {
  printf("will send: %.*s", data.len, data.ptr);
  PostStreamState *state;
  curl_easy_getinfo(curl, CURLINFO_PRIVATE, &state);
  if (state) {
    writePostStreamState(state, data);
    curl_easy_pause(curl, CURLPAUSE_CONT);
  } else {
    curl_easy_setopt(curl, CURLOPT_READFUNCTION, xpostread);
    curl_easy_setopt(curl, CURLOPT_READDATA, curl);
    curl_easy_setopt(curl, CURLOPT_PRIVATE, initPostStreamState(data));
  }
}

enum XSet {
  X_USERAGENT = 0,
  X_PROXY = 1,
  X_METHOD = 2,
};

int xinit(CURL* curl, enum XSet xopt, char const *text) {
  CURLoption opt;
  switch (xopt) {
    case X_USERAGENT: opt = CURLOPT_USERAGENT; break;
    case X_PROXY: opt = CURLOPT_PROXY; break;
    case X_METHOD: {
      if (strcmp(text, "GET") == 0) {
        curl_easy_setopt(curl, CURLOPT_HTTPGET, 1);
      } else if (strcmp(text, "POST") == 0) {
        curl_easy_setopt(curl, CURLOPT_POST, 1);
      }
      opt = CURLOPT_CUSTOMREQUEST;
      break;
    }
    default: return 1;
  }
  curl_easy_setopt(curl, opt, text);
  return 0;
}

int request(
  LPSTR url,
  tjsvec_buf data,
  tjscallback init,
  tjscallback cb
) {
  CURL *curl scoped(autocurl) = curl_easy_init();
  if (!curl) return 1;
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void *)&cb);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, handler);
  curl_easy_setopt(curl, CURLOPT_URL, url);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  TJS_NOTIFY_DATA(init, 1, TJS_DATA_POINTER(curl));
  if (data.len) {
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, data.ptr);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, data.len);
  }
  CURLcode res = curl_easy_perform(curl);
  if(res != CURLE_OK) {
    printf("err: %s\n", curl_easy_strerror(res));
    return 2;
  }
  return 0;
}
`);
const api = httpcompiler.relocate({
  xinit: "pis!i" as const,
  xpost: "pv!_" as const,
  request: "sv[p][v]!i" as const,
});
export function writepost(ptr: bigint, data: ArrayBuffer) {
  api.xpost(ptr, data);
}
export function request(cfg: {
  url: string,
  method?: string,
  useragent?: string,
  proxy?: string,
  data?: ArrayBuffer,
  init?: (p: bigint) => void,
  recv?: (data: Uint8Array) => void,
}) {
  let buffer: number[] = [];
  const ret = api.request(
    cfg.url,
    cfg.data ? cfg.data : new ArrayBuffer(0),
    p => {
      if (cfg.useragent) api.xinit(p, 0, cfg.useragent);
      if (cfg.proxy) api.xinit(p, 1, cfg.proxy);
      if (cfg.method) api.xinit(p, 2, cfg.method);
      if (cfg.init) cfg.init(p);
    },
    r => {
      if (cfg.recv) cfg.recv(new Uint8Array(r));
      buffer.push(...new Uint8Array(r));
    });
  if (ret != 0) {
    throw new Error("err: " + ret);
  }
  return new Uint8Array(buffer);
}