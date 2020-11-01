import { Compiler } from "builtin:c";
import { log } from "builtin:io";

const compiler = new Compiler("memory");
compiler.link('kernel32');
compiler.link('user32');
compiler.compile(`
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

int checkConsole() {
  DWORD list[16];
  return GetConsoleProcessList(list, 16);
}

void msgbox(wchar_t const *text) {
  MessageBoxW(NULL, text, L"from js", 0);
}

void hideConsole() {
  FreeConsole();
}
`);

const api = compiler.relocate({
  checkConsole: "!i" as const,
  msgbox: "w" as const,
  hideConsole: "" as const,
});

if (api.checkConsole() == 1) {
  api.hideConsole();
}

api.msgbox("" + api.checkConsole());