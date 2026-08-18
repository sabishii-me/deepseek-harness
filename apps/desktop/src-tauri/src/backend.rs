use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

const READY_PREFIX: &str = "dsh web: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

pub struct BackendState {
    child: Mutex<Option<Child>>,
}

impl BackendState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn terminate(&self) {
        let Some(mut child) = self.child.lock().expect("backend mutex poisoned").take() else {
            return;
        };
        terminate_tree(&mut child);
    }
}

pub fn start(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        if let Err(error) = run(&app, &window) {
            eprintln!("dsh desktop: {error}");
            let message = format!(
                "DeepSeek Harness backend failed to start.\n\n{error}\n\nSee the terminal for backend logs."
            );
            let script = format!(
                "document.body.innerHTML = '<main><h1>Backend startup failed</h1><p style=\"white-space:pre-wrap\"></p></main>'; document.querySelector('p').textContent = {};",
                js_string(&message)
            );
            let _ = window.eval(&script);
            app.state::<BackendState>().terminate();
        }
    });
}

fn run(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let root = repository_root()?;
    let terminal = crate::terminal_server::start()?;
    let entry = root.join("apps/desktop/backend/dev.ts");
    let mut child = Command::new("bun")
        .arg(entry)
        .env("DSH_DESKTOP_TERMINAL_ADDRESS", terminal.address)
        .env("DSH_DESKTOP_TERMINAL_TOKEN", terminal.token)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not launch Bun from PATH: {error}"))?;

    let stdout = child.stdout.take().ok_or("Bun stdout was not piped")?;
    let stderr = child.stderr.take().ok_or("Bun stderr was not piped")?;
    pipe_logs(stderr, "backend");
    app.state::<BackendState>()
        .child
        .lock()
        .map_err(|_| "backend mutex poisoned")?
        .replace(child);

    let ready = wait_for_ready(app, stdout)?;
    let url =
        Url::parse(&ready).map_err(|error| format!("invalid backend readiness URL: {error}"))?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        return Err(format!("backend returned a non-loopback origin: {url}"));
    }
    window
        .navigate(url)
        .map_err(|error| format!("could not navigate the WebView: {error}"))?;
    Ok(())
}

fn wait_for_ready(app: &AppHandle, stdout: impl Read + Send + 'static) -> Result<String, String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                return;
            }
        }
    });
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let line = match receiver.recv_timeout(remaining) {
            Ok(line) => line.map_err(|error| format!("could not read backend stdout: {error}"))?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                app.state::<BackendState>().terminate();
                return Err("backend readiness timed out after 60 seconds".to_owned());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        println!("[backend] {line}");
        if let Some(url) = readiness_url(&line) {
            return Ok(url.to_owned());
        }
    }
    let status = app
        .state::<BackendState>()
        .child
        .lock()
        .map_err(|_| "backend mutex poisoned")?
        .as_mut()
        .and_then(|child| child.try_wait().ok().flatten());
    Err(format!(
        "backend stdout closed before readiness (status: {status:?})"
    ))
}

fn readiness_url(line: &str) -> Option<&str> {
    line.strip_prefix(READY_PREFIX)?.split_whitespace().next()
}

fn pipe_logs(stream: impl Read + Send + 'static, label: &'static str) {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            match line {
                Ok(line) => eprintln!("[{label}] {line}"),
                Err(error) => {
                    eprintln!("[{label}] log stream failed: {error}");
                    break;
                }
            }
        }
    });
}

fn repository_root() -> Result<PathBuf, String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .ok_or_else(|| "could not resolve repository root from Cargo manifest".to_owned())
}

#[cfg(windows)]
fn terminate_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.wait();
}

#[cfg(not(windows))]
fn terminate_tree(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn js_string(value: &str) -> String {
    format!("{:?}", value)
}

#[cfg(test)]
mod tests {
    use super::readiness_url;

    #[test]
    fn extracts_the_canonical_url_from_readiness() {
        assert_eq!(
            readiness_url("dsh web: http://127.0.0.1:49152 (LAN: http://10.0.0.2:49152)"),
            Some("http://127.0.0.1:49152")
        );
        assert_eq!(readiness_url("ordinary backend log"), None);
    }
}
