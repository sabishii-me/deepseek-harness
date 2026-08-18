use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    Spawn {
        id: u64,
        argv: Vec<String>,
        cwd: String,
        env: HashMap<String, String>,
        rows: u16,
        cols: u16,
    },
    Write {
        id: u64,
        data: String,
    },
    Resize {
        id: u64,
        rows: u16,
        cols: u16,
    },
    Signal {
        id: u64,
        signal: String,
    },
    Terminate {
        id: u64,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum Event {
    Ready { id: u64, pid: Option<u32> },
    Data { id: u64, data: String },
    Exit { id: u64, exit_code: Option<u32> },
    Ack { id: u64 },
    Error { id: Option<u64>, message: String },
}

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

type Terminals = Arc<Mutex<HashMap<u64, Terminal>>>;

pub struct TerminalServer {
    pub address: String,
    pub token: String,
}

pub fn start() -> Result<TerminalServer, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("could not bind terminal service: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("could not inspect terminal service address: {error}"))?
        .to_string();
    let mut secret = [0_u8; 32];
    rand::rng().fill_bytes(&mut secret);
    let token = BASE64.encode(secret);
    let expected = token.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let expected = expected.clone();
                    thread::spawn(move || serve(stream, &expected));
                }
                Err(error) => eprintln!("terminal service accept failed: {error}"),
            }
        }
    });
    Ok(TerminalServer { address, token })
}

fn serve(stream: TcpStream, expected_token: &str) {
    let writer = match stream.try_clone() {
        Ok(stream) => Arc::new(Mutex::new(stream)),
        Err(error) => {
            eprintln!("terminal service clone failed: {error}");
            return;
        }
    };
    let mut lines = BufReader::new(stream).lines();
    let Some(Ok(token)) = lines.next() else {
        return;
    };
    if token != expected_token {
        send(
            &writer,
            &Event::Error {
                id: None,
                message: "authentication failed".into(),
            },
        );
        return;
    }
    let terminals: Terminals = Arc::new(Mutex::new(HashMap::new()));
    for line in lines {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                send(
                    &writer,
                    &Event::Error {
                        id: None,
                        message: error.to_string(),
                    },
                );
                continue;
            }
        };
        if let Err((id, message)) = handle(request, &terminals, &writer) {
            send(&writer, &Event::Error { id, message });
        }
    }
    terminate_all(&terminals);
}

fn handle(
    request: Request,
    terminals: &Terminals,
    output: &Arc<Mutex<TcpStream>>,
) -> Result<(), (Option<u64>, String)> {
    match request {
        Request::Spawn {
            id,
            argv,
            cwd,
            env,
            rows,
            cols,
        } => {
            let Some(program) = argv.first() else {
                return Err((Some(id), "terminal argv is empty".into()));
            };
            let pair = native_pty_system()
                .openpty(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| (Some(id), error.to_string()))?;
            let mut command = CommandBuilder::new(program);
            command.args(&argv[1..]);
            command.cwd(cwd);
            command.env_clear();
            for (key, value) in env {
                command.env(key, value);
            }
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|error| (Some(id), error.to_string()))?;
            drop(pair.slave);
            let pid = child.process_id();
            let mut reader = pair
                .master
                .try_clone_reader()
                .map_err(|error| (Some(id), error.to_string()))?;
            let writer = pair
                .master
                .take_writer()
                .map_err(|error| (Some(id), error.to_string()))?;
            terminals.lock().map_err(lock_error)?.insert(
                id,
                Terminal {
                    master: pair.master,
                    writer,
                    child,
                },
            );
            send(output, &Event::Ready { id, pid });
            let terminal_map = terminals.clone();
            let event_output = output.clone();
            thread::spawn(move || {
                let mut buffer = [0_u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            let bytes = &buffer[..count];
                            // Git for Windows asks its terminal frontend for the
                            // cursor position before readline accepts input.
                            // This transport has no emulator, so answer with a
                            // stable origin just as a minimal dumb terminal does.
                            if bytes.windows(4).any(|window| window == b"\x1b[6n") {
                                if let Ok(mut map) = terminal_map.lock() {
                                    if let Some(terminal) = map.get_mut(&id) {
                                        let _ = terminal.writer.write_all(b"\x1b[1;1R");
                                        let _ = terminal.writer.flush();
                                    }
                                }
                            }
                            send(
                                &event_output,
                                &Event::Data {
                                    id,
                                    data: BASE64.encode(bytes),
                                },
                            )
                        }
                    }
                }
                let terminal = terminal_map.lock().ok().and_then(|mut map| map.remove(&id));
                let exit_code = terminal
                    .and_then(|mut terminal| terminal.child.wait().ok())
                    .map(|status| status.exit_code());
                send(&event_output, &Event::Exit { id, exit_code });
            });
        }
        Request::Write { id, data } => {
            let bytes = BASE64
                .decode(data)
                .map_err(|error| (Some(id), error.to_string()))?;
            let mut map = terminals.lock().map_err(lock_error)?;
            let terminal = map
                .get_mut(&id)
                .ok_or((Some(id), "unknown terminal".into()))?;
            terminal
                .writer
                .write_all(&bytes)
                .and_then(|_| terminal.writer.flush())
                .map_err(|error| (Some(id), error.to_string()))?;
            send(output, &Event::Ack { id });
        }
        Request::Resize { id, rows, cols } => {
            let map = terminals.lock().map_err(lock_error)?;
            let terminal = map.get(&id).ok_or((Some(id), "unknown terminal".into()))?;
            terminal
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| (Some(id), error.to_string()))?;
            send(output, &Event::Ack { id });
        }
        Request::Signal { id, signal } => {
            if signal != "SIGINT" {
                return Err((Some(id), format!("unsupported terminal signal: {signal}")));
            }
            let mut map = terminals.lock().map_err(lock_error)?;
            let terminal = map
                .get_mut(&id)
                .ok_or((Some(id), "unknown terminal".into()))?;
            terminal
                .writer
                .write_all(&[0x03])
                .and_then(|_| terminal.writer.flush())
                .map_err(|error| (Some(id), error.to_string()))?;
            send(output, &Event::Ack { id });
        }
        Request::Terminate { id } => {
            if let Some(mut terminal) = terminals.lock().map_err(lock_error)?.remove(&id) {
                terminal
                    .child
                    .kill()
                    .map_err(|error| (Some(id), error.to_string()))?;
            }
            send(output, &Event::Ack { id });
        }
    }
    Ok(())
}

fn terminate_all(terminals: &Terminals) {
    if let Ok(mut map) = terminals.lock() {
        for (_, mut terminal) in map.drain() {
            let _ = terminal.child.kill();
        }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> (Option<u64>, String) {
    (None, "terminal service mutex poisoned".into())
}

fn send(output: &Arc<Mutex<TcpStream>>, event: &Event) {
    let Ok(mut output) = output.lock() else {
        return;
    };
    if serde_json::to_writer(&mut *output, event).is_ok() {
        let _ = output.write_all(b"\n");
        let _ = output.flush();
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{start, Event, Request};
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use std::{
        collections::HashMap,
        io::{BufRead, BufReader, Write},
        net::TcpStream,
        path::Path,
        time::Duration,
    };

    #[test]
    fn git_bash_round_trip_uses_rust_conpty_transport() {
        let program = r"C:\Program Files\Git\bin\bash.exe";
        if !Path::new(program).is_file() {
            return;
        }
        let server = start().expect("start terminal service");
        let mut socket = TcpStream::connect(&server.address).expect("connect terminal service");
        socket
            .set_read_timeout(Some(Duration::from_secs(15)))
            .expect("read timeout");
        writeln!(socket, "{}", server.token).expect("authenticate");
        let request = Request::Spawn {
            id: 1,
            argv: vec![
                program.into(),
                "--noprofile".into(),
                "--norc".into(),
                "--noediting".into(),
                "-i".into(),
            ],
            cwd: std::env::current_dir().expect("cwd").display().to_string(),
            env: std::env::vars()
                .chain([
                    ("TERM".into(), "dumb".into()),
                    ("PS1".into(), "DSH-RUST> ".into()),
                ])
                .collect::<HashMap<_, _>>(),
            rows: 40,
            cols: 160,
        };
        writeln!(
            socket,
            "{}",
            serde_json::to_string(&request).expect("spawn json")
        )
        .expect("spawn");
        let mut reader = BufReader::new(socket.try_clone().expect("clone socket"));
        let mut line = String::new();
        loop {
            line.clear();
            reader.read_line(&mut line).expect("read ready");
            let event: Event = serde_json::from_str(line.trim()).expect("ready event");
            if matches!(event, Event::Ready { id: 1, .. }) {
                break;
            }
        }
        std::thread::sleep(Duration::from_secs(1));
        let command = Request::Write {
            id: 1,
            data: BASE64.encode(b"printf 'rust-conpty-ok\\n'\r"),
        };
        writeln!(
            socket,
            "{}",
            serde_json::to_string(&command).expect("write json")
        )
        .expect("write");
        let mut output = Vec::new();
        loop {
            line.clear();
            reader.read_line(&mut line).expect("read output");
            let event: Event = serde_json::from_str(line.trim()).expect("output event");
            if let Event::Data { data, .. } = event {
                output.extend(BASE64.decode(data).expect("base64 output"));
                if String::from_utf8_lossy(&output).contains("rust-conpty-ok") {
                    break;
                }
            }
        }
        let terminate = Request::Terminate { id: 1 };
        writeln!(
            socket,
            "{}",
            serde_json::to_string(&terminate).expect("terminate json")
        )
        .expect("terminate");
    }
}
