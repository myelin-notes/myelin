use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};

struct PeerConnection {
    stream: TcpStream,
}

pub struct PeerState {
    connection: Arc<Mutex<Option<PeerConnection>>>,
}

impl PeerState {
    pub fn new() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
        }
    }
}

/// Length-prefix framing: [4 bytes big-endian length][payload]
async fn write_frame(stream: &mut TcpStream, data: &[u8]) -> std::io::Result<()> {
    let len = (data.len() as u32).to_be_bytes();
    stream.write_all(&len).await?;
    stream.write_all(data).await?;
    stream.flush().await
}

async fn read_frame(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(buf)
}

fn spawn_read_loop(app: AppHandle, stream_half: Arc<Mutex<Option<PeerConnection>>>) {
    let conn = stream_half.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let data = {
                let mut guard = conn.lock().await;
                let Some(peer) = guard.as_mut() else {
                    break;
                };
                match read_frame(&mut peer.stream).await {
                    Ok(data) => data,
                    Err(_) => {
                        *guard = None;
                        let _ = app.emit("peer-disconnected", ());
                        break;
                    }
                }
            };
            let _ = app.emit("peer-update", data);
        }
    });
}

#[tauri::command]
pub async fn peer_host(
    app: AppHandle,
    state: tauri::State<'_, PeerState>,
    port: u16,
) -> Result<String, String> {
    // Close existing connection
    {
        let mut guard = state.connection.lock().await;
        *guard = None;
    }

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;

    // Get local IP for display
    let addr_str = format!("{}", local_addr);

    let conn = state.connection.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok((stream, peer_addr)) = listener.accept().await {
            {
                let mut guard = conn.lock().await;
                *guard = Some(PeerConnection { stream });
            }
            let _ = app_clone.emit("peer-connected", format!("{}", peer_addr));
            spawn_read_loop(app_clone, conn);
        }
    });

    Ok(addr_str)
}

#[tauri::command]
pub async fn peer_join(
    app: AppHandle,
    state: tauri::State<'_, PeerState>,
    addr: String,
) -> Result<(), String> {
    // Close existing connection
    {
        let mut guard = state.connection.lock().await;
        *guard = None;
    }

    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

    {
        let mut guard = state.connection.lock().await;
        *guard = Some(PeerConnection { stream });
    }

    let _ = app.emit("peer-connected", addr);
    spawn_read_loop(app, state.connection.clone());

    Ok(())
}

#[tauri::command]
pub async fn peer_send(
    state: tauri::State<'_, PeerState>,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut guard = state.connection.lock().await;
    let peer = guard
        .as_mut()
        .ok_or_else(|| "No peer connected".to_string())?;
    write_frame(&mut peer.stream, &data)
        .await
        .map_err(|e| format!("Send failed: {}", e))
}

#[tauri::command]
pub async fn peer_disconnect(
    app: AppHandle,
    state: tauri::State<'_, PeerState>,
) -> Result<(), String> {
    let mut guard = state.connection.lock().await;
    *guard = None;
    let _ = app.emit("peer-disconnected", ());
    Ok(())
}

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    // Find local network IP
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("{}", e))?;
    socket
        .connect("8.8.8.8:80")
        .map_err(|e| format!("{}", e))?;
    let addr = socket
        .local_addr()
        .map_err(|e| format!("{}", e))?;
    Ok(format!("{}", addr.ip()))
}
