use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

use bytes::Bytes;
use iroh::{
    address_lookup::memory::MemoryLookup, endpoint::presets, protocol::Router, Endpoint, EndpointId,
};
use iroh_gossip::{
    api::{Event as GossipEvent, GossipSender},
    Gossip, TopicId,
};
use iroh_tickets::endpoint::EndpointTicket;
use n0_future::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
const GOSSIP_MAX_MESSAGE_SIZE: usize = 4 * 1024 * 1024;

pub struct IrohState {
    runtime: Mutex<Option<IrohRuntime>>,
}

impl IrohState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
        }
    }
}

struct IrohRuntime {
    endpoint: Endpoint,
    _router: Router,
    gossip: Gossip,
    memory_lookup: MemoryLookup,
    topics: HashMap<String, ActiveTopic>,
}

struct ActiveTopic {
    transport_id: String,
    repository_id: Option<String>,
    sender: GossipSender,
    cancel: Option<oneshot::Sender<()>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteTransportPayload {
    note_id: String,
    transport_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagePayload {
    note_id: String,
    transport_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectedPayload {
    note_id: String,
    transport_id: String,
    peer_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    note_id: String,
    transport_id: String,
    message: String,
}

impl IrohRuntime {
    async fn start() -> Result<Self, String> {
        let memory_lookup = MemoryLookup::new();
        let endpoint = Endpoint::builder(presets::N0)
            .address_lookup(memory_lookup.clone())
            .bind()
            .await
            .map_err(|err| format!("Failed to bind iroh endpoint: {err}"))?;
        let gossip = Gossip::builder()
            .max_message_size(GOSSIP_MAX_MESSAGE_SIZE)
            .spawn(endpoint.clone());
        let router = Router::builder(endpoint.clone())
            .accept(iroh_gossip::ALPN, gossip.clone())
            .spawn();

        Ok(Self {
            endpoint,
            _router: router,
            gossip,
            memory_lookup,
            topics: HashMap::new(),
        })
    }

    async fn host(
        &mut self,
        app: &AppHandle,
        note_id: &str,
        transport_id: &str,
        repository: Option<(String, String)>,
    ) -> Result<String, String> {
        self.attach_topic(app, note_id, transport_id, repository, vec![])
            .await?;
        Ok(EndpointTicket::new(self.endpoint.addr()).to_string())
    }

    async fn join(
        &mut self,
        app: &AppHandle,
        note_id: &str,
        transport_id: &str,
        ticket: &str,
        repository: Option<(String, String)>,
    ) -> Result<(), String> {
        let ticket = EndpointTicket::from_str(ticket.trim())
            .map_err(|err| format!("Invalid iroh ticket: {err}"))?;
        let endpoint_addr = ticket.endpoint_addr().clone();
        let bootstrap = vec![endpoint_addr.id];
        self.memory_lookup.add_endpoint_info(endpoint_addr);

        self.attach_topic(app, note_id, transport_id, repository, bootstrap)
            .await
    }

    /// Look up the topic, validate the transport, and clone out the sender so
    /// the caller can broadcast without holding the runtime mutex.
    fn sender_for(&self, note_id: &str, transport_id: &str) -> Result<GossipSender, String> {
        let topic = self
            .topics
            .get(note_id)
            .ok_or_else(|| "No active iroh topic for this note".to_string())?;

        if topic.transport_id != transport_id {
            return Err("Transport instance is no longer active".to_string());
        }

        Ok(topic.sender.clone())
    }

    fn leave(&mut self, note_id: &str, transport_id: &str) {
        let Some(topic) = self.topics.get(note_id) else {
            return;
        };

        if topic.transport_id != transport_id {
            return;
        }

        self.leave_note(note_id);
    }

    async fn attach_topic(
        &mut self,
        app: &AppHandle,
        note_id: &str,
        transport_id: &str,
        repository: Option<(String, String)>,
        bootstrap: Vec<EndpointId>,
    ) -> Result<(), String> {
        self.leave_note(note_id);

        let topic = self
            .gossip
            .subscribe(note_topic_id(note_id), bootstrap)
            .await
            .map_err(|err| format!("Failed to join iroh topic: {err}"))?;
        let (sender, mut receiver) = topic.split();
        let (cancel_tx, mut cancel_rx) = oneshot::channel();

        let note_id_owned = note_id.to_string();
        let transport_id_owned = transport_id.to_string();
        let app_handle = app.clone();
        let repository_id = repository.as_ref().map(|(_, id)| id.clone());
        let repository_handle = repository.map(|(handle, _)| handle);
        let initial_sender = sender.clone();

        // Each joined note gets its own receiver task so transport events remain scoped.
        tauri::async_runtime::spawn(async move {
            let mut peers = HashSet::<EndpointId>::new();
            let mut emit_disconnect_on_exit = false;

            loop {
                tokio::select! {
                    _ = &mut cancel_rx => {
                        break;
                    }
                    event = receiver.next() => {
                        match event {
                            Some(Ok(GossipEvent::NeighborUp(peer_id))) => {
                                if peers.insert(peer_id) {
                                    if let Some(handle) = &repository_handle {
                                        match crate::repository_engine::initial_peer_state(&app_handle, handle, &note_id_owned).await {
                                            Ok(update) => {
                                                let mut data = vec![1];
                                                data.extend(update);
                                                if let Err(error) = initial_sender.broadcast(Bytes::from(data)).await {
                                                    let _ = emit_error(&app_handle, &note_id_owned, &transport_id_owned, error.to_string());
                                                }
                                            }
                                            Err(error) => { let _ = emit_error(&app_handle, &note_id_owned, &transport_id_owned, error); }
                                        }
                                    }
                                    let _ = emit_connected(
                                        &app_handle,
                                        &note_id_owned,
                                        &transport_id_owned,
                                        peer_id,
                                    );
                                }
                            }
                            Some(Ok(GossipEvent::NeighborDown(peer_id))) => {
                                peers.remove(&peer_id);
                                if peers.is_empty() {
                                    let _ = emit_disconnected(
                                        &app_handle,
                                        &note_id_owned,
                                        &transport_id_owned,
                                    );
                                    break;
                                }
                            }
                            Some(Ok(GossipEvent::Received(message))) => {
                                let data = message.content.to_vec();
                                if let Some(handle) = &repository_handle {
                                    if data.first() == Some(&1) {
                                        if let Err(error) = crate::repository_engine::peer_update(&app_handle, handle, &note_id_owned, data[1..].to_vec()).await {
                                            let _ = emit_error(&app_handle, &note_id_owned, &transport_id_owned, error);
                                        }
                                        continue;
                                    }
                                }
                                let _ = emit_message(
                                    &app_handle,
                                    &note_id_owned,
                                    &transport_id_owned,
                                    data,
                                );
                            }
                            Some(Ok(GossipEvent::Lagged)) => {
                                let _ = emit_error(
                                    &app_handle,
                                    &note_id_owned,
                                    &transport_id_owned,
                                    "Iroh gossip receiver lagged; reconnect to resume live sync."
                                        .to_string(),
                                );
                                emit_disconnect_on_exit = true;
                                break;
                            }
                            Some(Err(err)) => {
                                let _ = emit_error(
                                    &app_handle,
                                    &note_id_owned,
                                    &transport_id_owned,
                                    format!("Iroh gossip topic failed: {err}"),
                                );
                                emit_disconnect_on_exit = true;
                                break;
                            }
                            None => {
                                emit_disconnect_on_exit = true;
                                break;
                            }
                        }
                    }
                }
            }

            if emit_disconnect_on_exit {
                let _ = emit_disconnected(&app_handle, &note_id_owned, &transport_id_owned);
            }
        });

        self.topics.insert(
            note_id.to_string(),
            ActiveTopic {
                transport_id: transport_id.to_string(),
                repository_id,
                sender,
                cancel: Some(cancel_tx),
            },
        );

        Ok(())
    }

    fn leave_note(&mut self, note_id: &str) {
        if let Some(mut topic) = self.topics.remove(note_id) {
            drop(topic.sender);
            if let Some(cancel) = topic.cancel.take() {
                let _ = cancel.send(());
            }
        }
    }
}

fn note_topic_id(note_id: &str) -> TopicId {
    let hash = Sha256::digest(note_id.as_bytes());
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&hash);
    TopicId::from_bytes(bytes)
}

fn emit_message(
    app: &AppHandle,
    note_id: &str,
    transport_id: &str,
    data: Vec<u8>,
) -> Result<(), tauri::Error> {
    app.emit(
        "iroh-message",
        MessagePayload {
            note_id: note_id.to_string(),
            transport_id: transport_id.to_string(),
            data,
        },
    )
}

fn emit_connected(
    app: &AppHandle,
    note_id: &str,
    transport_id: &str,
    peer_id: EndpointId,
) -> Result<(), tauri::Error> {
    app.emit(
        "iroh-connected",
        ConnectedPayload {
            note_id: note_id.to_string(),
            transport_id: transport_id.to_string(),
            peer_id: peer_id.to_string(),
        },
    )
}

fn emit_disconnected(
    app: &AppHandle,
    note_id: &str,
    transport_id: &str,
) -> Result<(), tauri::Error> {
    app.emit(
        "iroh-disconnected",
        NoteTransportPayload {
            note_id: note_id.to_string(),
            transport_id: transport_id.to_string(),
        },
    )
}

fn emit_error(
    app: &AppHandle,
    note_id: &str,
    transport_id: &str,
    message: String,
) -> Result<(), tauri::Error> {
    app.emit(
        "iroh-error",
        ErrorPayload {
            note_id: note_id.to_string(),
            transport_id: transport_id.to_string(),
            message,
        },
    )
}

#[tauri::command]
pub async fn iroh_host(
    app: AppHandle,
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
    repository_handle: Option<String>,
) -> Result<String, String> {
    let repository = match repository_handle {
        Some(handle) => {
            let id = crate::repository_engine::repository_identity(&app, &handle).await?;
            Some((handle, id))
        }
        None => None,
    };
    let endpoint = {
        let mut runtime = state.runtime.lock().await;
        if runtime.is_none() {
            *runtime = Some(IrohRuntime::start().await?);
        }
        runtime
            .as_ref()
            .expect("runtime initialized")
            .endpoint
            .clone()
    };
    endpoint.online().await;
    let mut runtime = state.runtime.lock().await;
    runtime
        .as_mut()
        .expect("runtime initialized")
        .host(&app, &note_id, &transport_id, repository)
        .await
}

#[tauri::command]
pub async fn iroh_join(
    app: AppHandle,
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
    ticket: String,
    repository_handle: Option<String>,
) -> Result<(), String> {
    let repository = match repository_handle {
        Some(handle) => {
            let id = crate::repository_engine::repository_identity(&app, &handle).await?;
            Some((handle, id))
        }
        None => None,
    };
    let endpoint = {
        let mut runtime = state.runtime.lock().await;
        if runtime.is_none() {
            *runtime = Some(IrohRuntime::start().await?);
        }
        runtime
            .as_ref()
            .expect("runtime initialized")
            .endpoint
            .clone()
    };
    endpoint.online().await;
    let mut runtime = state.runtime.lock().await;
    runtime
        .as_mut()
        .expect("runtime initialized")
        .join(&app, &note_id, &transport_id, &ticket, repository)
        .await
}

pub(crate) async fn broadcast_document(
    app: &AppHandle,
    repository_id: &str,
    note_id: &str,
    update: Vec<u8>,
) {
    let state = app.state::<IrohState>();
    let sender = {
        let runtime = state.runtime.lock().await;
        runtime
            .as_ref()
            .and_then(|runtime| runtime.topics.get(note_id))
            .filter(|topic| topic.repository_id.as_deref() == Some(repository_id))
            .map(|topic| topic.sender.clone())
    };
    if let Some(sender) = sender {
        let mut data = vec![1];
        data.extend(update);
        if let Err(error) = sender.broadcast(Bytes::from(data)).await {
            eprintln!("[iroh] native document broadcast failed: {error}");
        }
    }
}

#[tauri::command]
pub async fn iroh_send(
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sender = {
        let mut runtime = state.runtime.lock().await;
        let runtime = runtime
            .as_mut()
            .ok_or_else(|| "Iroh transport is not initialized".to_string())?;
        runtime.sender_for(&note_id, &transport_id)?
    };

    let size = data.len();
    match sender.broadcast(Bytes::from(data)).await {
        Ok(()) => {
            eprintln!("[iroh] broadcast {size} bytes on note {note_id}");
            Ok(())
        }
        Err(err) => {
            eprintln!("[iroh] broadcast failed ({size} bytes): {err}");
            Err(format!("Failed to broadcast iroh message: {err}"))
        }
    }
}

#[tauri::command]
pub async fn iroh_leave(
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
) -> Result<(), String> {
    let mut runtime = state.runtime.lock().await;
    if let Some(runtime) = runtime.as_mut() {
        runtime.leave(&note_id, &transport_id);
    }
    Ok(())
}
