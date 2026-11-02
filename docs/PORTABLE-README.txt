KOOK Voice Lite - portable (Windows x64)

Keep kook_voice_lite.exe, WebView2Loader.dll and the resources directory together,
then run the exe. Uses the system WebView2 Evergreen Runtime. No Rust, MinGW or
development server is needed to run this application.

Use the “使用playwright调用” button to start the bundled extractor with the
system Microsoft Edge. Sign in and rejoin the target voice channel in Edge.
On success, the captured configuration is imported automatically; click Join
to connect. Progress and errors appear in the diagnostics page.
Real-channel voice operation and credential reuse still need validation.
Do not share exported credentials.

Login state: playwright-profile (next to the exe).
Configuration, diagnostics and logs: captures (next to the exe).
Window size and maximized state: window-state.json (next to the exe).
Use a writable directory. Window size is saved when hiding or exiting.
Successful join hides the window to the system tray. Right-click its icon for:
show/hide window; connection, devices and diagnostics pages; microphone mute;
headphone mute; disconnect; Playwright extraction; open captures/program folder;
exit. Voice controls are disabled while disconnected; mute checks match the UI.
