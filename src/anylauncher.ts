import { Compiler } from "builtin:c";
const compiler = new Compiler("exe");
compiler.option("-Wl,-subsystem=gui");
compiler.link("kernel32");
compiler.link("shell32");
compiler.compile(`
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#include <windows.h>
#include <shellapi.h>
int main() {
  WCHAR buffer[MAX_PATH + 1] = {0};
  GetModuleFileName(NULL, buffer, MAX_PATH);
  size_t len = wcslen(buffer);
  buffer[len - 3] = L'b';
  buffer[len - 2] = L'a';
  buffer[len - 1] = L't';
  ShellExecute(NULL, L"open", buffer, NULL, NULL, SW_HIDE);
}
`);
compiler.output("anylauncher.exe");