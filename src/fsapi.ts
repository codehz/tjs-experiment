import { Compiler } from "builtin:c";

const commoncompiler = new Compiler("memory");
commoncompiler.link("kernel32");
commoncompiler.compile(`
#define UNICODE
#include <windows.h>
#include <stdio.h>
#include <tjs.h>

BOOL chdir(wchar_t const *dir) {
  return SetCurrentDirectory(dir);
}

int getcwd(tjscallback cb) {
  wchar_t buf[MAX_PATH];
  int ret = GetCurrentDirectory(MAX_PATH, buf);
  if (ret != 0)
    return TJS_NOTIFY_DATA(cb, 1, TJS_DATA(buf));
  return ret != 0;
}

void cFindClose(HANDLE *h) {
  FindClose(*h);
}

void formatFimeTime(FILETIME *ftime, char buffer[static 24]) {
  SYSTEMTIME utc;
  FileTimeToSystemTime(ftime, &utc);
  sprintf(
    buffer,
    "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
    utc.wYear,
    utc.wMonth,
    utc.wDay,
    utc.wHour,
    utc.wMinute,
    utc.wSecond,
    utc.wMilliseconds
  );
}

int listfiles(tjscallback cb) {
  WIN32_FIND_DATA ffd;
  HANDLE hFind scoped(cFindClose);
  hFind = FindFirstFileW(L"*", &ffd);
  if (hFind == INVALID_HANDLE_VALUE) {
    return -1;
  }
  do {
    char xaccess[25] = {0};
    char xwrite[25] = {0};
    formatFimeTime(&ffd.ftLastAccessTime, xaccess);
    formatFimeTime(&ffd.ftLastWriteTime, xwrite);
    int64_t filesize = ((int64_t)ffd.nFileSizeHigh << 32) | (int64_t)ffd.nFileSizeLow;
    int r = TJS_NOTIFY_DATA(cb, 5,
      TJS_DATA((int)ffd.dwFileAttributes),
      TJS_DATA(xaccess),
      TJS_DATA(xwrite),
      TJS_DATA(filesize),
      TJS_DATA(ffd.cFileName));
    if (r != 0) return r;
  } while (FindNextFile(hFind, &ffd) != 0);
  return 0;
}

`);
const raw = commoncompiler.relocate({
  chdir: "w!i" as const,
  getcwd: "[w]!i" as const,
  listfiles: "[isspw]!i" as const,
});

export function chdir(path: string) {
  if (!raw.chdir(path)) throw new Error("failed to chdir");
}

export function getcwd() {
  let ret: string | void = undefined;
  raw.getcwd(x => { ret = x; });
  if (ret != null) return ret;
  throw new Error("failed to get cwd");
}

export function withdir<T>(path: string, callback: () => T) {
  const origin = getcwd();
  chdir(path);
  try {
    const ret = callback();
    return ret;
  } finally {
    chdir(origin);
  }
}

export interface FileInfo {
  attr: number,
  access: Date,
  write: Date,
  filesize: bigint,
  filename: string,
};

export function listfiles() {
  const list: FileInfo[] = [];
  raw.listfiles((attr, access, write, filesize, filename) => {
    list.push({
      attr,
      access: new Date(access),
      write: new Date(write),
      filesize: filesize,
      filename,
    });
  })
  return list;
}

export function forEachFiles(callback: (info: FileInfo) => boolean | void) {
  raw.listfiles((attr, access, write, filesize, filename) => {
    const r = callback({
      attr,
      access: new Date(access),
      write: new Date(write),
      filesize: filesize,
      filename,
    });
    if (r === false) return 1;
  });
}