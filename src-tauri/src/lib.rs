use std::{
    fs::OpenOptions,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::Duration,
};

mod voice;
use voice::NativeVoice;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct WindowSize {
    width: f64,
    height: f64,
    maximized: bool,
}

struct SavedWindowSize(Mutex<WindowSize>);

struct TrayControls {
    microphone: CheckMenuItem<tauri::Wry>,
    headset: CheckMenuItem<tauri::Wry>,
    disconnect: MenuItem<tauri::Wry>,
}

fn update_voice_tray(app: &AppHandle, state: &serde_json::Value) {
    if let Some(controls) = app.try_state::<TrayControls>() {
        let connected = state["connected"].as_bool().unwrap_or(false);
        let busy = state["busy"].as_bool().unwrap_or(false);
        let _ = controls
            .microphone
            .set_enabled(connected && !busy && !state["listenOnly"].as_bool().unwrap_or(false));
        let _ = controls.headset.set_enabled(connected && !busy);
        let _ = controls.disconnect.set_enabled(connected && !busy);
        let _ = controls
            .microphone
            .set_checked(state["muted"].as_bool().unwrap_or(false));
        let _ = controls
            .headset
            .set_checked(state["deafened"].as_bool().unwrap_or(false));
    }
}

#[tauri::command]
fn sync_tray_controls(
    controls: tauri::State<'_, TrayControls>,
    connected: bool,
    microphone_available: bool,
    muted: bool,
    deafened: bool,
    busy: bool,
) -> Result<(), String> {
    controls
        .microphone
        .set_enabled(connected && microphone_available && !busy)
        .map_err(|e| e.to_string())?;
    controls
        .headset
        .set_enabled(connected && !busy)
        .map_err(|e| e.to_string())?;
    controls
        .disconnect
        .set_enabled(connected && !busy)
        .map_err(|e| e.to_string())?;
    controls
        .microphone
        .set_checked(muted)
        .map_err(|e| e.to_string())?;
    controls
        .headset
        .set_checked(deafened)
        .map_err(|e| e.to_string())
}

fn program_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
        .map(normalize_windows_path)
        .ok_or_else(|| "无法定位程序目录".to_string())
}

fn save_window_size(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let (Some(saved), Ok(directory)) = (app.try_state::<SavedWindowSize>(), program_dir()) {
            if let Ok(mut size) = saved.0.lock() {
                size.maximized = window.is_maximized().unwrap_or(false);
                if let Ok(json) = serde_json::to_vec(&*size) {
                    let _ = std::fs::write(directory.join("window-state.json"), json);
                }
            }
        }
    }
}

#[tauri::command]
fn hide_to_tray(window: WebviewWindow) -> Result<(), String> {
    save_window_size(window.app_handle());
    let voice = window.state::<NativeVoice>();
    let busy = voice.snapshot.lock().unwrap()["busy"]
        .as_bool()
        .unwrap_or(false);
    if busy || voice.extracting.load(std::sync::atomic::Ordering::Relaxed) {
        window.hide().map_err(|error| error.to_string())
    } else {
        // Voice lives in the native helper; release the entire WebView, including GPU surfaces.
        window.destroy().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("main") {
        window
    } else {
        let window = WebviewWindowBuilder::from_config(&app, &app.config().app.windows[0])
            .map_err(|e| e.to_string())?
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        configure_window(&window).map_err(|e| e.to_string())?;
        window
    };
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    save_window_size(&app);
    app.exit(0);
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(stripped) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn resource_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .map_err(|error| format!("无法定位程序目录：{error}"))?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位程序目录".to_string())?;
    let resource_dir = app.path().resource_dir().ok();
    let mut candidates = Vec::new();
    if let Some(directory) = resource_dir {
        candidates.push(directory.join(name));
        candidates.push(directory.join("resources").join(name));
    }
    candidates.push(exe_dir.join(name));
    candidates.push(exe_dir.join("resources").join(name));
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("发行包缺少资源：{name}"))
}

#[tauri::command]
async fn run_playwright_extractor(
    app: AppHandle,
    channel: Option<String>,
) -> Result<serde_json::Value, String> {
    let channel = channel.unwrap_or_default().trim().to_string();
    if !channel.is_empty() && !channel.chars().all(|character| character.is_ascii_digit()) {
        return Err("频道 ID 必须是数字".to_string());
    }
    let node = normalize_windows_path(resource_file(&app, "node.exe")?);
    let script = normalize_windows_path(resource_file(&app, "playwright-extract-voice.mjs")?);
    let program_dir = program_dir()?;
    let profile = program_dir.join("playwright-profile");
    let output = program_dir.join("captures");
    std::fs::create_dir_all(&output).map_err(|error| format!("无法创建 captures 目录：{error}"))?;
    let status_file = output.join("playwright-status.json");
    // Clear the previous run so an old configuration cannot be imported as a new capture.
    std::fs::write(
        &status_file,
        r#"{"stage":"starting","message":"正在启动 Playwright…"}"#,
    )
    .map_err(|error| format!("无法创建提取状态文件：{error}"))?;
    let log_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(output.join("playwright-run.log"))
        .map_err(|error| format!("无法打开 Playwright 日志：{error}"))?;
    let log_error = log_file
        .try_clone()
        .map_err(|error| format!("无法复制 Playwright 日志句柄：{error}"))?;
    let mut command = Command::new(node);
    command
        .arg(script)
        .arg("--timeout")
        .arg("180000")
        .arg("--profile")
        .arg(&profile)
        .arg("--output")
        .arg(&output)
        .current_dir(&program_dir)
        .env("KOOK_VOICE_PROGRAM_DIR", &program_dir)
        .env("KOOK_PLAYWRIGHT_PROFILE", &profile)
        .env("KOOK_VOICE_OUTPUT", &output)
        .env("KOOK_PLAYWRIGHT_STATUS", &status_file)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_error));
    if !channel.is_empty() {
        command.arg("--channel-id").arg(&channel);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // Hide Node's console; Edge retains its own window.
    }
    app.state::<NativeVoice>()
        .extracting
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let extraction_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 Playwright：{error}"))?;
        let mut last_stage = String::new();
        loop {
            let status = std::fs::read(&status_file)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            if let Some(ref status) = status {
                let stage = status["stage"].as_str().unwrap_or_default();
                if stage != last_stage {
                    // Progress events contain no credentials. The result goes only to the invoking window.
                    let _ = app.emit_to(
                        "main",
                        "playwright-progress",
                        serde_json::json!({
                          "stage": stage, "message": status["message"],
                        }),
                    );
                    last_stage = stage.to_string();
                }
            }
            if let Some(exit) = child
                .try_wait()
                .map_err(|error| format!("无法等待 Playwright：{error}"))?
            {
                // Re-read after process exit: the final status may have changed since the last poll.
                let final_status = std::fs::read(&status_file)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
                if let Some(status) = final_status {
                    if exit.success() && status["stage"] == "done" && status["config"].is_object() {
                        return Ok(status["config"].clone());
                    }
                    if status["stage"] == "error" {
                        return Err(status["message"].as_str().unwrap_or("提取失败").to_string());
                    }
                }
                return Err("Playwright 未生成配置，请查看 captures/playwright-run.log".to_string());
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    })
    .await
    .map_err(|error| format!("等待提取结果失败：{error}"));
    extraction_app
        .state::<NativeVoice>()
        .extracting
        .store(false, std::sync::atomic::Ordering::Relaxed);
    result?
}

fn configure_window(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle();
    let mut size = app.state::<SavedWindowSize>().0.lock().unwrap().clone();
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let bounds = monitor.size().to_logical::<f64>(monitor.scale_factor());
        size.width = size.width.clamp(560.0, bounds.width.max(560.0));
        size.height = size.height.clamp(420.0, (bounds.height - 60.0).max(420.0));
    }
    window.set_size(LogicalSize::new(size.width, size.height))?;
    if size.maximized {
        window.maximize()?;
    }
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Resized(physical_size) = event {
            if !handle.is_maximized().unwrap_or(false)
                && !handle.is_minimized().unwrap_or(false)
                && physical_size.width > 0
                && physical_size.height > 0
            {
                if let Ok(scale) = handle.scale_factor() {
                    let saved = handle.state::<SavedWindowSize>();
                    let mut size = saved.0.lock().unwrap();
                    let logical = physical_size.to_logical::<f64>(scale);
                    size.width = logical.width;
                    size.height = logical.height;
                }
            }
        }
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hide_to_tray(handle.clone());
        }
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(NativeVoice::default())
        .invoke_handler(tauri::generate_handler![
            hide_to_tray,
            show_window,
            exit_app,
            run_playwright_extractor,
            sync_tray_controls,
            voice::voice_command,
            voice::app_snapshot,
            voice::save_ui
        ])
        .setup(|app| {
            let size = program_dir()
                .ok()
                .and_then(|directory| std::fs::read(directory.join("window-state.json")).ok())
                .and_then(|bytes| serde_json::from_slice::<WindowSize>(&bytes).ok())
                .unwrap_or(WindowSize {
                    width: 900.0,
                    height: 620.0,
                    maximized: false,
                });
            app.manage(SavedWindowSize(Mutex::new(size)));
            if let Some(window) = app.get_webview_window("main") {
                configure_window(&window)?;
            }
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let connect = MenuItem::with_id(app, "connect", "语音连接", true, None::<&str>)?;
            let microphone = CheckMenuItem::with_id(
                app,
                "microphone",
                "麦克风静音",
                false,
                false,
                None::<&str>,
            )?;
            let headset =
                CheckMenuItem::with_id(app, "headset", "耳机静音", false, false, None::<&str>)?;
            let disconnect = MenuItem::with_id(app, "disconnect", "断开语音", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let separator1 = PredefinedMenuItem::separator(app)?;
            let separator2 = PredefinedMenuItem::separator(app)?;
            let separator3 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &separator1,
                    &connect,
                    &separator2,
                    &microphone,
                    &headset,
                    &disconnect,
                    &separator3,
                    &quit,
                ],
            )?;
            app.manage(TrayControls {
                microphone,
                headset,
                disconnect,
            });
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| "缺少托盘图标".to_string())?;

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("KOOK Voice Lite")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_window(app.clone());
                    }
                    "connect" => {
                        app.state::<NativeVoice>().ui.lock().unwrap()["view"] =
                            serde_json::json!("connect");
                        let _ = show_window(app.clone());
                        let _ = app.emit_to("main", "tray-action", "connect");
                    }
                    "microphone" | "headset" | "disconnect" => {
                        let action = if event.id.as_ref() == "disconnect" {
                            "leave"
                        } else {
                            event.id.as_ref()
                        }
                        .to_string();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) =
                                voice::voice_command(app.clone(), action, None).await
                            {
                                let _ = show_window(app.clone());
                                let _ = app.emit_to("main", "tray-error", error);
                            }
                        });
                    }
                    "quit" => {
                        save_window_size(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("KOOK Voice Lite 启动失败")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
                api.prevent_exit()
            }
            tauri::RunEvent::Exit => app.state::<NativeVoice>().stop(),
            _ => {}
        });
}
