use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{
        tcp::{OwnedReadHalf, OwnedWriteHalf},
        TcpListener, TcpStream,
    },
    sync::Mutex,
};

pub struct PeerState {
    writer: Arc<Mutex<Option<OwnedWriteHalf>>>,
    /// Signals the read loop to stop when the connection is replaced.
    cancel: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl PeerState {
    pub fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
            cancel: Arc::new(Mutex::new(None)),
        }
    }
}

async fn write_frame(writer: &mut OwnedWriteHalf, data: &[u8]) -> std::io::Result<()> {
    let len = (data.len() as u32).to_be_bytes();
    writer.write_all(&len).await?;
    writer.write_all(data).await?;
    writer.flush().await
}

async fn read_frame(reader: &mut OwnedReadHalf) -> std::io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(buf)
}

fn setup_connection(
    app: &AppHandle,
    state: &PeerState,
    stream: TcpStream,
) -> tokio::sync::oneshot::Sender<()> {
    let (reader, writer) = stream.into_split();

    // Store writer for peer_send
    {
        let w = state.writer.clone();
        tauri::async_runtime::spawn(async move {
            *w.lock().await = Some(writer);
        });
    }

    // Spawn read loop
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = reader;
        let mut cancel_rx = cancel_rx;
        loop {
            tokio::select! {
                result = read_frame(&mut reader) => {
                    match result {
                        Ok(data) => {
                            let _ = app_clone.emit("peer-update", data);
                        }
                        Err(_) => {
                            let _ = app_clone.emit("peer-disconnected", ());
                            break;
                        }
                    }
                }
                _ = &mut cancel_rx => {
                    break;
                }
            }
        }
    });

    cancel_tx
}

async fn close_existing(state: &PeerState) {
    *state.writer.lock().await = None;
    if let Some(cancel) = state.cancel.lock().await.take() {
        let _ = cancel.send(());
    }
}

#[tauri::command]
pub async fn peer_host(
    app: AppHandle,
    state: tauri::State<'_, PeerState>,
    port: u16,
) -> Result<String, String> {
    close_existing(&state).await;

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    let addr_str = format!(
        "{}",
        listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
    );

    let writer = state.writer.clone();
    let cancel_store = state.cancel.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Ok((stream, peer_addr)) = listener.accept().await {
            let (reader, w) = stream.into_split();
            *writer.lock().await = Some(w);

            let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
            *cancel_store.lock().await = Some(cancel_tx);

            let _ = app_clone.emit("peer-connected", format!("{}", peer_addr));

            // Read loop
            let mut reader = reader;
            let mut cancel_rx = cancel_rx;
            loop {
                tokio::select! {
                    result = read_frame(&mut reader) => {
                        match result {
                            Ok(data) => {
                                let _ = app_clone.emit("peer-update", data);
                            }
                            Err(_) => {
                                *writer.lock().await = None;
                                let _ = app_clone.emit("peer-disconnected", ());
                                break;
                            }
                        }
                    }
                    _ = &mut cancel_rx => {
                        break;
                    }
                }
            }
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
    close_existing(&state).await;

    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;

    let cancel_tx = setup_connection(&app, &state, stream);
    *state.cancel.lock().await = Some(cancel_tx);

    let _ = app.emit("peer-connected", addr);
    Ok(())
}

#[tauri::command]
pub async fn peer_send(state: tauri::State<'_, PeerState>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.writer.lock().await;
    let writer = guard
        .as_mut()
        .ok_or_else(|| "No peer connected".to_string())?;
    write_frame(writer, &data)
        .await
        .map_err(|e| format!("Send failed: {}", e))
}

#[tauri::command]
pub async fn peer_disconnect(
    app: AppHandle,
    state: tauri::State<'_, PeerState>,
) -> Result<(), String> {
    close_existing(&state).await;
    let _ = app.emit("peer-disconnected", ());
    Ok(())
}

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("{}", e))?;
    socket.connect("8.8.8.8:80").map_err(|e| format!("{}", e))?;
    let addr = socket.local_addr().map_err(|e| format!("{}", e))?;
    Ok(format!("{}", addr.ip()))
}
