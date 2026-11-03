use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Reply>>>>;

fn idle_state() -> Value {
    json!({"connected":false,"busy":false,"muted":false,"deafened":false,"listenOnly":false,"peers":[],"channelId":""})
}

struct Process {
    child: Child,
    stdin: ChildStdin,
    pending: Pending,
}

pub struct NativeVoice {
    process: Mutex<Option<Process>>,
    next_id: AtomicU64,
    generation: Arc<AtomicU64>,
    pub snapshot: Arc<Mutex<Value>>,
    pub ui: Mutex<Value>,
    pub logs: Arc<Mutex<Vec<String>>>,
    pub extracting: AtomicBool,
}

impl Default for NativeVoice {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            next_id: AtomicU64::new(1),
            generation: Arc::new(AtomicU64::new(0)),
            snapshot: Arc::new(Mutex::new(idle_state())),
            ui: Mutex::new(json!({})),
            logs: Arc::new(Mutex::new(Vec::new())),
            extracting: AtomicBool::new(false),
        }
    }
}

impl NativeVoice {
    fn start(&self, app: &AppHandle) -> Result<Process, String> {
        let node = super::normalize_windows_path(super::resource_file(app, "node.exe")?);
        let script = super::normalize_windows_path(super::resource_file(app, "native/host.mjs")?);
        let mut command = Command::new(node);
        command
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // Keep credentials off the command line and disk. Only stdin carries join requests.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动原生语音进程：{e}"))?;
        let stdin = child.stdin.take().ok_or("无法打开语音输入管道")?;
        let stdout = child.stdout.take().ok_or("无法打开语音输出管道")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let replies = pending.clone();
        let snapshot = self.snapshot.clone();
        let logs = self.logs.clone();
        let generation = self.generation.clone();
        let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(id) = message["id"].as_u64() {
                    if let Some(sender) = replies.lock().unwrap().remove(&id) {
                        let result = if let Some(error) = message["error"].as_str() {
                            Err(error.to_string())
                        } else {
                            Ok(message["result"].clone())
                        };
                        let _ = sender.send(result);
                    }
                } else if generation.load(Ordering::SeqCst) == current {
                    let event = message["event"].as_str().unwrap_or_default();
                    let payload = message["payload"].clone();
                    if event == "state" {
                        *snapshot.lock().unwrap() = payload.clone();
                        super::update_voice_tray(&app, &payload);
                    }
                    if event == "log" {
                        if let Some(text) = payload["message"].as_str() {
                            let mut buffer = logs.lock().unwrap();
                            buffer.push(text.chars().take(250).collect());
                            if buffer.len() > 60 {
                                buffer.remove(0);
                            }
                        }
                    }
                    let _ = app.emit_to(
                        "main",
                        "voice-event",
                        json!({"event":event,"payload":payload}),
                    );
                }
            }
            for (_, sender) in replies.lock().unwrap().drain() {
                let _ = sender.send(Err("原生语音进程已退出".into()));
            }
            if generation.load(Ordering::SeqCst) == current {
                let idle = idle_state();
                *snapshot.lock().unwrap() = idle.clone();
                super::update_voice_tray(&app, &idle);
                let _ = app.emit_to(
                    "main",
                    "voice-event",
                    json!({"event":"state","payload":idle}),
                );
            }
        });
        Ok(Process {
            child,
            stdin,
            pending,
        })
    }

    pub fn request(&self, app: &AppHandle, action: &str, args: Value) -> Reply {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        let pending;
        {
            let mut guard = self.process.lock().unwrap();
            let dead = guard
                .as_mut()
                .map(|p| p.child.try_wait().ok().flatten().is_some())
                .unwrap_or(true);
            if dead {
                *guard = Some(self.start(app)?);
            }
            let process = guard.as_mut().unwrap();
            pending = process.pending.clone();
            pending.lock().unwrap().insert(id, sender);
            let mut line = serde_json::to_vec(&json!({"id":id,"action":action,"args":args}))
                .map_err(|e| e.to_string())?;
            line.push(b'\n');
            if process
                .stdin
                .write_all(&line)
                .and_then(|_| process.stdin.flush())
                .is_err()
            {
                pending.lock().unwrap().remove(&id);
                return Err("无法写入原生语音管道".into());
            }
        }
        let reply = receiver
            .recv_timeout(Duration::from_secs(45))
            .unwrap_or_else(|_| Err("原生语音操作超时".into()));
        pending.lock().unwrap().remove(&id);
        // Native heaps and codec state disappear completely between sessions.
        if action == "leave" || (action == "join" && reply.is_err()) {
            self.stop();
        }
        reply
    }

    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(mut process) = self.process.lock().unwrap().take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        *self.snapshot.lock().unwrap() = idle_state();
    }
}

#[tauri::command]
pub async fn voice_command(app: AppHandle, action: String, args: Option<Value>) -> Reply {
    const ACTIONS: &[&str] = &[
        "join",
        "leave",
        "devices",
        "snapshot",
        "meter",
        "microphone",
        "headset",
        "input",
        "output",
        "peer",
    ];
    if !ACTIONS.contains(&action.as_str()) {
        return Err("不支持的语音操作".into());
    }
    // Hiding/restoring a window must never start a native process by itself.
    if action == "meter" && app.state::<NativeVoice>().process.lock().unwrap().is_none() {
        return Ok(Value::Null);
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeVoice>()
            .request(&app, &action, args.unwrap_or_else(|| json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn app_snapshot(voice: tauri::State<'_, NativeVoice>) -> Value {
    let mut ui = voice.ui.lock().unwrap();
    let result = json!({"voice":*voice.snapshot.lock().unwrap(),"ui":*ui,"logs":*voice.logs.lock().unwrap()});
    if let Some(object) = ui.as_object_mut() {
        object.remove("action");
    }
    result
}

#[tauri::command]
pub fn save_ui(voice: tauri::State<'_, NativeVoice>, ui: Value) {
    *voice.ui.lock().unwrap() = ui;
}
