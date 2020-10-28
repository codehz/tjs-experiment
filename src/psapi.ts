import { Compiler } from "builtin:c";
import { err, log } from "builtin:io";
import {decode} from "builtin:utf16";

const compiler = new Compiler("memory");
compiler.link("ntdll");
compiler.link("psapi");
compiler.compile(`
#define UNICODE
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <tjs.h>
#include <ntdll.h>

void pfree(void **pp) {
  free(*pp);
}

#define autobuffer(name, size) void * name scoped(pfree) = malloc(size)

void formatKernelTime(LARGE_INTEGER xtime, char buffer[static 24]) {
  SYSTEMTIME utc;
  FILETIME ft;
  ft.dwLowDateTime = xtime.u.LowPart;
  ft.dwHighDateTime = xtime.u.HighPart;
  FileTimeToSystemTime(&ft, &utc);
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

int listprocess(tjscallback cb) {
  int tt[] = {1, 2};
  ULONG len = 131072;
  while (true) {
    autobuffer(buffer, len);
    if (buffer == NULL) return 1;
    auto Status = NtQuerySystemInformation(SystemProcessInformation, buffer, len, &len);
    if (Status == STATUS_INFO_LENGTH_MISMATCH) {
      len *= 2;
      continue;
    } else if (!NT_SUCCESS(Status)) {
      return 2;
    }
    PSYSTEM_PROCESS_INFORMATION infoP = (PSYSTEM_PROCESS_INFORMATION) buffer;
    while (true) {
      char CreateTime[25] = {0};
      formatKernelTime(infoP->CreateTime, CreateTime);
      TJS_NOTIFY_DATA(cb, 3,
        TJS_DATA((int32_t)infoP->UniqueProcessId),
        TJS_DATA(CreateTime),
        TJS_DATA_VECTOR2(infoP->ImageName.Buffer, infoP->ImageName.Length));
      if (!infoP->NextEntryOffset) return 0;
      infoP = (PSYSTEM_PROCESS_INFORMATION)(((LPBYTE)infoP) + infoP->NextEntryOffset);
    }
  }

}
`);
const raw = compiler.relocate({
  listprocess: "[isv]!" as const
});
export interface ProcessInformation {
  pid: number,
  name: string,
  creationTime: Date,
}
export function getPidList() {
  let arr: ProcessInformation[] = [];
  raw.listprocess((i, v, w) => {
    arr.push({
      pid: i,
      name: decode(w),
      creationTime: new Date(v)
    });
  })
  return arr;
}