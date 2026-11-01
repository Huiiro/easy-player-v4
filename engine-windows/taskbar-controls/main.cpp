#include <windows.h>
#include <commctrl.h>
#include <algorithm>
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <thread>
#include <memory>

namespace {
constexpr UINT UpdateState = WM_APP + 1;
constexpr UINT ProbeState = WM_APP + 2;
struct State {
  bool playing = false, available = false, dark = true;
  std::wstring title = L"EasyPlayer", artist, album;
  std::wstring previous = L"Previous", play = L"Play", pause = L"Pause", next = L"Next";
};
State state;
HWND supervisor = nullptr, strip = nullptr, taskbar = nullptr, tooltip = nullptr;
HWND buttons[3] = {};
HWND information = nullptr;
std::wstring informationTip;
bool vertical = false;
bool receivedState = false;
bool probe = false;
bool layingOut = false;
int layoutUnit = 0;
unsigned renderCount = 0, layoutCount = 0;
int unit = 32;
int informationWidth = 160;
void renderStrip();

std::wstring decode(const std::string& hex) {
  if (hex.size() % 2 || hex.size() > 4096) return L"";
  std::string bytes;
  auto digit = [](char ch) { return ch >= '0' && ch <= '9' ? ch - '0' : ch >= 'a' && ch <= 'f' ? ch - 'a' + 10 : -1; };
  for (size_t i = 0; i < hex.size(); i += 2) {
    int a = digit(hex[i]), b = digit(hex[i + 1]);
    if (a < 0 || b < 0) return L"";
    bytes.push_back(static_cast<char>(a * 16 + b));
  }
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0);
  std::wstring result(length, L'\0');
  if (length) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(bytes.size()), result.data(), length);
  return result;
}
void updateButtons() {
  if (!IsWindow(strip)) return;
  const wchar_t* labels[] = {state.previous.c_str(), state.playing ? state.pause.c_str() : state.play.c_str(), state.next.c_str()};
  for (int i = 0; i < 3; ++i) {
    EnableWindow(buttons[i], state.available);
    SetWindowTextW(buttons[i], labels[i]);
    TOOLINFOW tool{sizeof(tool)};
    tool.hwnd = strip;
    tool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    tool.uId = reinterpret_cast<UINT_PTR>(buttons[i]);
    tool.lpszText = const_cast<wchar_t*>(labels[i]);
    SendMessageW(tooltip, TTM_UPDATETIPTEXTW, 0, reinterpret_cast<LPARAM>(&tool));
    InvalidateRect(buttons[i], nullptr, FALSE);
  }
  informationTip = state.title;
  if (!state.artist.empty()) informationTip += L"\n" + state.artist;
  if (!state.album.empty()) informationTip += L"\n" + state.album;
  SetWindowTextW(information, informationTip.c_str());
  TOOLINFOW infoTool{sizeof(infoTool)};
  infoTool.hwnd = strip; infoTool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
  infoTool.uId = reinterpret_cast<UINT_PTR>(information); infoTool.lpszText = informationTip.data();
  SendMessageW(tooltip, TTM_UPDATETIPTEXTW, 0, reinterpret_cast<LPARAM>(&infoTool));
  InvalidateRect(information, nullptr, TRUE);
  renderStrip();
}
void paintButton(const DRAWITEMSTRUCT& item) {
  HDC dc = item.hDC;
  const RECT rect = item.rcItem;
  const COLORREF background = state.dark ? RGB(0,0,0) : RGB(255,255,255);
  HBRUSH brush = CreateSolidBrush(background);
  FillRect(dc, &rect, brush);
  DeleteObject(brush);
  const bool disabled = !state.available;
  COLORREF foreground = disabled ? (state.dark ? RGB(100,100,100) : RGB(170,170,170)) : (state.dark ? RGB(240,240,240) : RGB(40,40,40));
  if (item.itemState & ODS_SELECTED) {
    brush = CreateSolidBrush(state.dark ? RGB(70,70,70) : RGB(210,210,210));
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
  }
  int cx = (rect.right + rect.left) / 2, cy = (rect.bottom + rect.top) / 2;
  int s = std::max(4, unit / 6);
  HPEN pen = CreatePen(PS_SOLID, std::max(2, unit / 14), foreground);
  HBRUSH fill = CreateSolidBrush(foreground);
  auto oldPen = SelectObject(dc, pen);
  auto oldBrush = SelectObject(dc, fill);
  const int index = static_cast<int>(item.CtlID) - 100;
  if (index == 1 && state.playing) {
    Rectangle(dc, cx-s, cy-s, cx-s/3, cy+s);
    Rectangle(dc, cx+s/3, cy-s, cx+s, cy+s);
  } else {
    int direction = index == 0 ? -1 : 1;
    POINT points[] = {{cx-direction*s,cy-s}, {cx-direction*s,cy+s}, {cx+direction*s,cy}};
    Polygon(dc, points, 3);
    if (index != 1) {
      int x = cx + direction*(s+2);
      MoveToEx(dc, x, cy-s, nullptr);
      LineTo(dc, x, cy+s);
    }
  }
  SelectObject(dc, oldPen);
  SelectObject(dc, oldBrush);
  DeleteObject(pen);
  DeleteObject(fill);
  if (item.itemState & ODS_FOCUS) DrawFocusRect(dc, &rect);
}
void paintInformation(const DRAWITEMSTRUCT& item) {
  HDC dc = item.hDC;
  RECT rect = item.rcItem;
  HBRUSH background = CreateSolidBrush(state.dark ? RGB(0,0,0) : RGB(255,255,255));
  FillRect(dc, &rect, background); DeleteObject(background);
  SetBkMode(dc, TRANSPARENT);
  const int padding = MulDiv(6, unit, 32);
  rect.left += padding; rect.right -= padding;
  const std::wstring secondary = state.artist.empty() ? state.album : state.artist;
  RECT titleRect = rect, artistRect = rect;
  if (!secondary.empty()) {
    titleRect.bottom = rect.top + (rect.bottom-rect.top)*9/16;
    artistRect.top = titleRect.bottom;
  }
  HFONT titleFont = CreateFontW(-MulDiv(12, unit, 32),0,0,0,FW_MEDIUM,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,ANTIALIASED_QUALITY,DEFAULT_PITCH,L"Segoe UI");
  auto old = SelectObject(dc, titleFont);
  SetTextColor(dc, state.dark ? RGB(242,242,242) : RGB(32,32,32));
  DrawTextW(dc, state.title.c_str(), static_cast<int>(state.title.size()), &titleRect, DT_SINGLELINE|DT_VCENTER|DT_END_ELLIPSIS|DT_NOPREFIX);
  if (!secondary.empty()) {
    HFONT artistFont = CreateFontW(-MulDiv(11, unit, 32),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
    SelectObject(dc, artistFont);
    SetTextColor(dc, state.dark ? RGB(175,175,175) : RGB(95,95,95));
    DrawTextW(dc, secondary.c_str(), static_cast<int>(secondary.size()), &artistRect, DT_SINGLELINE|DT_VCENTER|DT_END_ELLIPSIS|DT_NOPREFIX);
    SelectObject(dc, titleFont); DeleteObject(artistFont);
  }
  SelectObject(dc, old); DeleteObject(titleFont);
}
// Composite text and controls onto one alpha surface. A nearly invisible background
// keeps the entire button rectangles clickable while showing the taskbar underneath.
void renderStrip() {
  if (!IsWindow(strip) || layingOut) return;
  RECT client{}; GetClientRect(strip, &client);
  const int width = client.right, height = client.bottom;
  if (width <= 1 || height <= 1 || !IsWindow(information)) return;
  HDC screen = GetDC(nullptr);
  HDC dc = CreateCompatibleDC(screen);
  BITMAPINFO bitmap{};
  bitmap.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bitmap.bmiHeader.biWidth = width; bitmap.bmiHeader.biHeight = -height;
  bitmap.bmiHeader.biPlanes = 1; bitmap.bmiHeader.biBitCount = 32;
  bitmap.bmiHeader.biCompression = BI_RGB;
  void* pixels = nullptr;
  HBITMAP surface = CreateDIBSection(screen, &bitmap, DIB_RGB_COLORS, &pixels, nullptr, 0);
  if (!dc || !surface) {
    if (surface) DeleteObject(surface);
    if (dc) DeleteDC(dc);
    ReleaseDC(nullptr, screen); return;
  }
  auto oldBitmap = SelectObject(dc, surface);
  HBRUSH background = CreateSolidBrush(state.dark ? RGB(0,0,0) : RGB(255,255,255));
  FillRect(dc, &client, background); DeleteObject(background);
  for (int i = 0; i < 4; ++i) {
    HWND control = i == 3 ? information : buttons[i];
    RECT bounds{}; GetWindowRect(control, &bounds);
    MapWindowPoints(nullptr, strip, reinterpret_cast<POINT*>(&bounds), 2);
    SetViewportOrgEx(dc, bounds.left, bounds.top, nullptr);
    DRAWITEMSTRUCT item{}; item.hDC = dc; item.hwndItem = control;
    item.CtlID = i == 3 ? 103 : 100+i;
    item.rcItem = {0, 0, bounds.right-bounds.left, bounds.bottom-bounds.top};
    if (i == 3) paintInformation(item);
    else {
      if (SendMessageW(control, BM_GETSTATE, 0, 0) & BST_PUSHED) item.itemState |= ODS_SELECTED;
      paintButton(item);
    }
  }
  SetViewportOrgEx(dc, 0, 0, nullptr);
  GdiFlush(); // Complete batched drawing before reading the DIB pixels.
  auto bytes = static_cast<unsigned char*>(pixels);
  for (int i = 0; i < width*height; ++i) {
    auto pixel = bytes + i*4;
    const int coverage = state.dark ? std::max({pixel[0],pixel[1],pixel[2]}) :
      255-std::min({pixel[0],pixel[1],pixel[2]});
    // Grayscale coverage produces clean antialiased edges on transparent pixels.
    pixel[0] = pixel[1] = pixel[2] = state.dark ? static_cast<unsigned char>(coverage) : 0;
    pixel[3] = static_cast<unsigned char>(std::max(1, coverage));
  }
  SIZE size{width, height}; POINT source{};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  const BOOL rendered = UpdateLayeredWindow(strip, screen, nullptr, &size, dc, &source, 0, &blend, ULW_ALPHA);
  if (rendered) ++renderCount;
  if (probe && !rendered) std::cerr << "render failed " << GetLastError() << std::endl;
  SelectObject(dc, oldBitmap); DeleteObject(surface); DeleteDC(dc); ReleaseDC(nullptr, screen);
}
LRESULT CALLBACK stripProc(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  switch (message) {
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
      PAINTSTRUCT paint{}; BeginPaint(window, &paint); EndPaint(window, &paint);
      renderStrip(); return 0;
    }
    case WM_DRAWITEM:
      renderStrip(); return TRUE;
    case WM_COMMAND:
      if (HIWORD(wp) == BN_CLICKED && state.available) {
        int index = LOWORD(wp) - 100;
        if (index >= 0 && index < 3) {
          const char* actions[] = {"previous", "toggle", "next"};
          std::cout << actions[index] << std::endl;
        }
      }
      return 0;
  }
  return DefWindowProcW(window, message, wp, lp);
}
void positionStrip() {
  if (!receivedState) return;
  HWND shell = FindWindowW(L"Shell_TrayWnd", nullptr);
  if (!shell || !IsWindowVisible(shell)) {
    if (IsWindow(strip)) ShowWindow(strip, SW_HIDE);
    return;
  }
  if (shell != taskbar || !IsWindow(strip)) {
    if (IsWindow(strip)) DestroyWindow(strip);
    taskbar = shell;
    strip = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED, L"EasyPlayerTaskbarStrip", L"EasyPlayer", WS_POPUP | WS_CLIPCHILDREN, 0,0,1,1, shell, nullptr, GetModuleHandleW(nullptr), nullptr);
    layoutUnit = 0;
    if (!strip) return;
    tooltip = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, nullptr, WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX, CW_USEDEFAULT,CW_USEDEFAULT,CW_USEDEFAULT,CW_USEDEFAULT, strip, nullptr, GetModuleHandleW(nullptr), nullptr);
    for (int i = 0; i < 3; ++i) {
      buttons[i] = CreateWindowExW(0, L"BUTTON", L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW, 0,0,1,1, strip, reinterpret_cast<HMENU>(static_cast<INT_PTR>(100+i)), GetModuleHandleW(nullptr), nullptr);
      TOOLINFOW tool{sizeof(tool)};
      tool.hwnd = strip; tool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
      tool.uId = reinterpret_cast<UINT_PTR>(buttons[i]); tool.lpszText = const_cast<wchar_t*>(L"");
      SendMessageW(tooltip, TTM_ADDTOOLW, 0, reinterpret_cast<LPARAM>(&tool));
    }
    information = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_OWNERDRAW, 0,0,1,1, strip, reinterpret_cast<HMENU>(103), GetModuleHandleW(nullptr), nullptr);
    TOOLINFOW infoTool{sizeof(infoTool)};
    infoTool.hwnd = strip; infoTool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    infoTool.uId = reinterpret_cast<UINT_PTR>(information); infoTool.lpszText = const_cast<wchar_t*>(L"");
    SendMessageW(tooltip, TTM_ADDTOOLW, 0, reinterpret_cast<LPARAM>(&infoTool));
    updateButtons();
  }
  DWORD systemLight = 0, size = sizeof(systemLight);
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
      L"SystemUsesLightTheme", RRF_RT_REG_DWORD, nullptr, &systemLight, &size) == ERROR_SUCCESS) {
    const bool dark = systemLight == 0;
    if (state.dark != dark) { state.dark = dark; updateButtons(); }
  }
  RECT bounds{}; GetClientRect(shell, &bounds);
  vertical = bounds.bottom > bounds.right;
  const UINT dpi = GetDpiForWindow(shell);
  unit = MulDiv(32, dpi ? dpi : 96, 96);
  const int padding = MulDiv(4, dpi ? dpi : 96, 96);
  int width = vertical ? bounds.right : unit*3+MulDiv(160, dpi ? dpi : 96, 96);
  int height = vertical ? unit*5 : bounds.bottom;
  HWND notify = FindWindowExW(shell, nullptr, L"TrayNotifyWnd", nullptr);
  RECT tray{};
  if (notify && GetWindowRect(notify, &tray)) MapWindowPoints(nullptr, shell, reinterpret_cast<POINT*>(&tray), 2);
  else {
    // Keep clear of the clock and notification icons if the shell has no named tray child.
    tray.left = bounds.right - MulDiv(240, dpi ? dpi : 96, 96);
    tray.top = bounds.bottom - MulDiv(160, dpi ? dpi : 96, 96);
  }
  if (!vertical) width = std::max(unit*3, std::min<int>(width, tray.left-padding));
  informationWidth = vertical ? width : width-unit*3;
  int x = vertical ? 0 : tray.left-width-padding;
  int y = vertical ? tray.top-height-padding : 0;
  if (x < 0 || y < 0) { ShowWindow(strip, SW_HIDE); return; }
  // A child of Shell_TrayWnd is occluded by Windows 11's composited taskbar.
  // Keep our independent tool window aligned with the tray in screen coordinates.
  POINT origin{x, y}; ClientToScreen(shell, &origin);
  RECT shellBounds{}; GetWindowRect(shell, &shellBounds);
  MONITORINFO monitor{sizeof(monitor)};
  GetMonitorInfoW(MonitorFromWindow(shell, MONITOR_DEFAULTTONEAREST), &monitor);
  RECT visible{};
  bool show = IntersectRect(&visible, &shellBounds, &monitor.rcMonitor) &&
    (vertical ? visible.right-visible.left : visible.bottom-visible.top) > padding;
  HWND foreground = GetForegroundWindow();
  RECT foregroundBounds{};
  wchar_t foregroundClass[128]{};
  if (foreground) GetClassNameW(foreground, foregroundClass, 128);
  const bool desktop = wcscmp(foregroundClass, L"Progman") == 0 || wcscmp(foregroundClass, L"WorkerW") == 0;
  if (!desktop && foreground && foreground != shell && foreground != strip &&
      GetWindowRect(foreground, &foregroundBounds) &&
      foregroundBounds.left <= monitor.rcMonitor.left && foregroundBounds.top <= monitor.rcMonitor.top &&
      foregroundBounds.right >= monitor.rcMonitor.right && foregroundBounds.bottom >= monitor.rcMonitor.bottom)
    show = false;
  if (!show) { ShowWindow(strip, SW_HIDE); return; }
  RECT current{}; GetWindowRect(strip, &current);
  const bool changed = current.left != origin.x || current.top != origin.y ||
    current.right-current.left != width || current.bottom-current.top != height || layoutUnit != unit;
  if (changed) {
    // Keep the existing composed frame until all child hit areas have moved.
    layingOut = true;
    SetWindowPos(strip, nullptr, origin.x,origin.y,width,height,
      SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOREDRAW);
    MoveWindow(information, 0,0,informationWidth,vertical ? unit*2 : height, FALSE);
    for (int i = 0; i < 3; ++i)
      MoveWindow(buttons[i], vertical ? 0 : informationWidth+i*unit, vertical ? (i+2)*unit : 0,
        vertical ? width : unit, vertical ? unit : height, FALSE);
    layoutUnit = unit;
    layingOut = false;
    ++layoutCount;
    renderStrip();
  }
  // An owned popup remains above its taskbar owner when Explorer is activated.
  // Do not repeatedly raise/redraw an unchanged transparent window on each timer.
  if (!IsWindowVisible(strip)) ShowWindow(strip, SW_SHOWNOACTIVATE);
}
void printProbe() {
    if (probe && IsWindowVisible(strip)) {
      RECT panel{}, parent{}, notify{};
      GetWindowRect(strip, &panel); GetWindowRect(taskbar, &parent);
      HWND tray = FindWindowExW(taskbar, nullptr, L"TrayNotifyWnd", nullptr);
      if (tray) GetWindowRect(tray, &notify);
      std::cout << "layout|" << panel.left << '|' << panel.top << '|' << panel.right << '|' << panel.bottom
        << '|' << parent.left << '|' << parent.top << '|' << parent.right << '|' << parent.bottom
        << '|' << notify.left << '|' << notify.top << '|' << IsWindowEnabled(buttons[1]) << '|' << state.playing
        << '|' << (GetAncestor(strip, GA_ROOT) == strip) << '|' << GetWindowTextLengthW(information)
        << '|' << informationWidth << '|' << vertical
        << '|' << ((GetWindowLongPtrW(strip, GWL_EXSTYLE) & WS_EX_LAYERED) != 0)
        << '|' << (GetWindow(strip, GW_OWNER) == taskbar) << '|' << renderCount << '|' << layoutCount << std::endl;
    }
}
LRESULT CALLBACK supervisorProc(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  if (message == ProbeState) { printProbe(); return 0; }
  if (message == UpdateState) {
    std::unique_ptr<State> next(reinterpret_cast<State*>(lp));
    // Tooltip strings refer to the state storage; replace and refresh on the UI thread.
    state = std::move(*next);
    receivedState = true;
    positionStrip(); updateButtons();
    printProbe();
    return 0;
  }
  if (message == WM_TIMER) { positionStrip(); return 0; }
  if (message == WM_CLOSE) {
    KillTimer(window, 1);
    if (IsWindow(strip)) DestroyWindow(strip);
    DestroyWindow(window); PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(window, message, wp, lp);
}
}
int main(int argc, char** argv) {
  probe = argc == 2 && std::string(argv[1]) == "--probe";
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  INITCOMMONCONTROLSEX common{sizeof(common), ICC_WIN95_CLASSES}; InitCommonControlsEx(&common);
  WNDCLASSW cls{}; cls.hInstance = GetModuleHandleW(nullptr); cls.lpfnWndProc = stripProc;
  cls.lpszClassName = L"EasyPlayerTaskbarStrip"; cls.hCursor = LoadCursorW(nullptr, IDC_ARROW); RegisterClassW(&cls);
  cls.lpszClassName = L"EasyPlayerTaskbarSupervisor"; cls.lpfnWndProc = supervisorProc; RegisterClassW(&cls);
  supervisor = CreateWindowExW(0, cls.lpszClassName, L"", 0,0,0,0,0, HWND_MESSAGE, nullptr, cls.hInstance, nullptr);
  if (!supervisor) return 1;
  SetTimer(supervisor, 1, 750, nullptr);
  std::thread([] {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (probe && line == "P") { PostMessageW(supervisor, ProbeState, 0, 0); continue; }
      if (line.size() > 16384) continue;
      std::vector<std::string> fields; std::stringstream input(line); std::string field;
      while (std::getline(input, field, '|')) fields.push_back(field);
      if ((fields.size() != 8 && fields.size() != 11) || fields[0] != "S") continue;
      auto next = std::make_unique<State>();
      next->playing = fields[1] == "1"; next->available = fields[2] == "1"; next->dark = fields[3] == "1";
      next->previous = decode(fields[4]); next->play = decode(fields[5]); next->pause = decode(fields[6]); next->next = decode(fields[7]);
      if (fields.size() == 11) { next->title = decode(fields[8]); next->artist = decode(fields[9]); next->album = decode(fields[10]); }
      State* message = next.release();
      if (!PostMessageW(supervisor, UpdateState, 0, reinterpret_cast<LPARAM>(message))) delete message;
    }
    PostMessageW(supervisor, WM_CLOSE, 0, 0);
  }).detach();
  // Wait for the host's first state before showing the strip.
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  return 0;
}
