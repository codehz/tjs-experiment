import { Compiler } from "builtin:c";
import { err, log } from "builtin:io";

const current = import.meta.url.substr(8).replaceAll('/', '\\');
const compiler = new Compiler("memory");
compiler.link("advapi32")
compiler.link("shell32");
compiler.link("user32");
compiler.link("comctl32");
compiler.compile(`
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define WINVER 0x0601
#define _WIN32_WINNT 0x0601
#define NTDDI_VERSION 0x06010000
#include <windows.h>
#include <wincred.h>
#include <shellapi.h>
#include <commctrl.h>
#include <winreg.h>
#include <shlobj.h>
#include <strsafe.h>
#include <tjs.h>

void hideConsole() {
  DWORD list[16];
  if (GetConsoleProcessList(list, 16) == 1) FreeConsole();
}

int getexepath(tjscallback cb) {
  WCHAR path[MAX_PATH];
  int ret = GetModuleFileNameW(NULL, path, MAX_PATH);
  TJS_NOTIFY_DATA(cb, 1, TJS_DATA(path));
  return ret;
}

BOOL checkIsProcessElevated() {
  BOOL fIsElevated = FALSE;
  HANDLE hToken = NULL;
  TOKEN_ELEVATION elevation;
  DWORD dwSize;

  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
    goto Cleanup;
  }

  if (!GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &dwSize)) {
    goto Cleanup;
  }

  fIsElevated = elevation.TokenIsElevated;

  Cleanup:
  if (hToken) {
    CloseHandle(hToken);
    hToken = NULL;
  }
  return fIsElevated;
}

void elevate(wchar_t const *current) {
  wchar_t szPath[MAX_PATH];
  if (GetModuleFileName(NULL, szPath, ARRAYSIZE(szPath))) {
    SHELLEXECUTEINFO sei = { sizeof(SHELLEXECUTEINFO) };
    sei.fMask = SEE_MASK_NO_CONSOLE;
    sei.lpVerb = L"runas";
    sei.lpFile = szPath;
    sei.lpParameters = current;
    ExitProcess(ShellExecuteEx(&sei));
  }
}
void msg(wchar_t const *str) {
  MessageBox(NULL, str, GetCommandLine(), MB_SETFOREGROUND);
}

CALLBACK HRESULT taskcb(
  HWND hwnd,
  UINT msg,
  WPARAM wParam,
  LPARAM lParam,
  LONG_PTR lpRefData
) {
  ShowWindow(hwnd, SW_SHOW);
  return S_OK;
}

int dialog(
  wchar_t const *wintitle,
  wchar_t const *title,
  wchar_t const *content,
  wchar_t const *collapsed,
  wchar_t const *info,
  wchar_t const *footer,
  wchar_t const *install,
  wchar_t const *uninstall) {
  InitCommonControls();
  HINSTANCE hinst = GetModuleHandle(NULL);
  TASKDIALOGCONFIG cfg = { sizeof(TASKDIALOGCONFIG) };
  cfg.hInstance = hinst;
  cfg.dwFlags =
    TDF_ALLOW_DIALOG_CANCELLATION |
    TDF_USE_COMMAND_LINKS |
    TDF_CAN_BE_MINIMIZED |
    TDF_EXPAND_FOOTER_AREA |
    TDF_ENABLE_HYPERLINKS;
  cfg.pszWindowTitle = wintitle;
  cfg.pszMainInstruction = title;
  cfg.pszContent = content;
  cfg.pfCallback = taskcb;
  cfg.cButtons = 2;
  TASKDIALOG_BUTTON btn[2] = {{ 101, install }, { 102, uninstall }};
  cfg.pButtons = btn;
  cfg.pszFooter = footer;
  cfg.pszCollapsedControlText = collapsed;
  cfg.pszExpandedInformation = info;
  cfg.pszFooterIcon = MAKEINTRESOURCE(TD_INFORMATION_ICON);
  cfg.pszMainIcon = MAKEINTRESOURCE(TD_SHIELD_ICON);
  int clicked;
  TaskDialogIndirect(&cfg, &clicked, NULL, NULL);
  return clicked;
}

#define CheckReg(cmd) ({ int code = cmd; if (ERROR_SUCCESS != code) return code; })

void pcloseKey(HKEY *pk) {
  RegCloseKey(*pk);
}

#define DefStr(name, text) \\
  wchar_t const *name = text; \\
  int name##_len = sizeof text

int install(int localmachine, wchar_t const *current, wchar_t const *open) {
  const int clen = lstrlenW(current) * 2 + 1;
  const int openlen = lstrlenW(open) * 2 + 1;
  DefStr(ProgId, L"Hz.tinyjs");
  DefStr(ContentType, L"text/plain");

  HKEY scoped(pcloseKey) root;
  CheckReg(RegOpenKey(localmachine ? HKEY_LOCAL_MACHINE : HKEY_CURRENT_USER, L"SOFTWARE\\\\Classes", &root));

  HKEY scoped(pcloseKey) dot;
  CheckReg(RegCreateKey(root, L".tjs", &dot));
  CheckReg(RegSetValueEx(dot, NULL, 0, REG_SZ, (BYTE const *)ProgId, ProgId_len));
  CheckReg(RegSetValueEx(dot, L"Content Type", 0, REG_SZ, (BYTE const *)ContentType, ContentType_len));

  HKEY scoped(pcloseKey) prog;
  CheckReg(RegCreateKey(root, L"Hz.tinyjs", &prog));
  CheckReg(RegSetKeyValueW(prog, L"DefaultIcon", NULL, REG_SZ, (BYTE const *)current, clen));
  CheckReg(RegSetKeyValueW(prog, L"Shell\\\\Open\\\\Command", NULL, REG_SZ, (BYTE const *)open, openlen));

  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
  return 0;
}

int RegDelnodeRecurse (HKEY hKeyRoot, LPTSTR lpSubKey) {
  LPTSTR lpEnd;
  LONG lResult;
  DWORD dwSize;
  TCHAR szName[MAX_PATH];
  HKEY hKey;
  FILETIME ftWrite;

  lResult = RegDeleteKey(hKeyRoot, lpSubKey);

  if (lResult == ERROR_SUCCESS) return lResult;

  lResult = RegOpenKeyEx (hKeyRoot, lpSubKey, 0, KEY_READ, &hKey);

  if (lResult != ERROR_SUCCESS)
  {
    if (lResult == ERROR_FILE_NOT_FOUND) {
      return 0;
    }
    else {
      return lResult;
    }
  }

  lpEnd = lpSubKey + lstrlen(lpSubKey);

  if (*(lpEnd - 1) != TEXT('\\\\')) {
    *lpEnd =  TEXT('\\\\');
    lpEnd++;
    *lpEnd =  TEXT('\\0');
  }

  dwSize = MAX_PATH;
  lResult = RegEnumKeyEx(hKey, 0, szName, &dwSize, NULL, NULL, NULL, &ftWrite);

  if (lResult == ERROR_SUCCESS) {
    do {

      StringCchCopy (lpEnd, MAX_PATH*2, szName);

      if (!RegDelnodeRecurse(hKeyRoot, lpSubKey)) {
        break;
      }

      dwSize = MAX_PATH;

      lResult = RegEnumKeyEx(hKey, 0, szName, &dwSize, NULL, NULL, NULL, &ftWrite);

    } while (lResult == ERROR_SUCCESS);
  }

  lpEnd--;
  *lpEnd = TEXT('\\0');

  RegCloseKey (hKey);

  return RegDeleteKey(hKeyRoot, lpSubKey);
}

int RegDelnode (HKEY hKeyRoot, LPTSTR lpSubKey) {
  TCHAR szDelKey[MAX_PATH*2];

  StringCchCopy (szDelKey, MAX_PATH*2, lpSubKey);
  return RegDelnodeRecurse(hKeyRoot, szDelKey);
}

int uninstall(int localmachine) {
  HKEY scoped(pcloseKey) root;
  CheckReg(RegOpenKey(localmachine ? HKEY_LOCAL_MACHINE : HKEY_CURRENT_USER, L"SOFTWARE\\\\Classes", &root));

  CheckReg(RegDelnode(root, L".tjs"));
  CheckReg(RegDelnode(root, L"Hz.tinyjs\\\\DefaultIcon"));
  CheckReg(RegDelnode(root, L"Hz.tinyjs\\\\Shell\\\\Open\\\\Command"));
  CheckReg(RegDelnode(root, L"Hz.tinyjs"));

  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
  return 0;
}
`);
const api = compiler.relocate({
  getexepath: "[w]!i" as const,
  checkIsProcessElevated: "!i" as const,
  elevate: "w" as const,
  msg: "w" as const,
  dialog: "wwwwwwww!i" as const,
  install: "iww!i" as const,
  uninstall: "i!i" as const,
  hideConsole: "" as const,
})
api.hideConsole();
if (!api.checkIsProcessElevated()) {
  const clicked = api.dialog(
    "TinyJS Installer",
    "Install/uninstall TJS",
    "Choose an install/uninstall method",
    "Copyright info",
    "Copyright 2020 CodeHz. All rights reserved.\nLicensed under the MIT license. See LICENSE file in the project root for details.",
    "Source code and issue tracker: <A HREF=\"tjs\">github.com/codehz/tjs</A>",
    "Install/Uninstall for current user",
    "Install/Uninstall for system"
  );
  switch (clicked) {
    case 101:
      start(false);
      break;
    case 102:
      api.elevate(current);
      break;
    default:
  }
} else {
  start(true);
}

function start(system: boolean) {
  const clicked = api.dialog(
    "TinyJS Installer",
    `Install TJS (${system ? "for system" : "for current user"})`,
    "Register *.tjs file type",
    "Copyright info",
    "Copyright 2020 CodeHz. All rights reserved.\nLicensed under the MIT license. See LICENSE file in the project root for details.",
    "Source code and issue tracker: <A HREF=\"tjs\">github.com/codehz/tjs</A>",
    "Install",
    "Uninstall");

  switch (clicked) {
    case 101:
      doinstall(system);
      break;
    case 102:
      douninstall(system);
      break;
    default: break;
  }
}

function doinstall(system: boolean) {
  let path: string = "";
  api.getexepath(x => { path = x; });
  const quoted = `"${path}"`;
  const open = `${quoted} "%1" %*`;
  const res = api.install(system ? 1 : 0, quoted, open);
  if (res == 0) {
    api.msg("Installation success!");
  } else {
    api.msg(`Installation failed, code: ${res}!`);
  }
}

function douninstall(system: boolean) {
  const res = api.uninstall(system ? 1 : 0);
  if (res == 0) {
    api.msg("Uninstallation success!");
  } else {
    api.msg(`Uninstallation failed, code: ${res}!`);
  }
}