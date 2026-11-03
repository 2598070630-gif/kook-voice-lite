KOOK Voice Lite - portable (Windows x64)

Keep kook_voice_lite.exe, WebView2Loader.dll and the resources directory together,
then run the exe. Uses the system WebView2 Evergreen Runtime with GPU acceleration
enabled. No Rust, MinGW or development server is needed to run this application.

Voice transport and WASAPI audio run in a native helper process. The WebView is
released while the app is in the tray and rebuilt when the window is shown.

Use the “使用playwright调用” button in the main window to import a voice
configuration. Device selection and diagnostics are also available in the main
window. Do not share exported credentials.

Login state: playwright-profile (next to the exe).
Configuration, diagnostics and logs: captures (next to the exe).
Window size and maximized state: window-state.json (next to the exe).
Use a writable directory. Window size is saved when hiding or exiting.
Successful join hides the window to the system tray. The tray menu contains:
显示窗口、语音连接、麦克风静音、耳机静音、断开语音、退出。
Voice controls are disabled while disconnected; mute checks match the UI.
