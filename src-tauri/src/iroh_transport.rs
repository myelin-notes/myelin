use std::{collections::{HashMap, HashSet}, str::FromStr};

use bytes::Bytes;
use iroh::{Endpoint, EndpointId, address_lookup::memory::MemoryLookup, endpoint::presets, protocol::Router};
use iroh_gossip::{Gossip, TopicId, api::{Event as GossipEvent, GossipSender}};
use iroh_tickets::endpoint::EndpointTicket;
use n0_future::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};

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
        let gossip = Gossip::builder().spawn(endpoint.clone());
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
    ) -> Result<String, String> {
        self.endpoint.online().await;
        self.attach_topic(app, note_id, transport_id, vec![]).await?;
        Ok(EndpointTicket::new(self.endpoint.addr()).to_string())
    }

    async fn join(
        &mut self,
        app: &AppHandle,
        note_id: &str,
        transport_id: &str,
        ticket: &str,
    ) -> Result<(), String> {
        self.endpoint.online().await;

        let ticket = EndpointTicket::from_str(ticket.trim())
            .map_err(|err| format!("Invalid iroh ticket: {err}"))?;
        let endpoint_addr = ticket.endpoint_addr().clone();
        let bootstrap = vec![endpoint_addr.id];
        self.memory_lookup.add_endpoint_info(endpoint_addr);

        self.attach_topic(app, note_id, transport_id, bootstrap).await
    }

    async fn send(
        &mut self,
        note_id: &str,
        transport_id: &str,
        data: Vec<u8>,
    ) -> Result<(), String> {
        let topic = self
            .topics
            .get(note_id)
            .ok_or_else(|| "No active iroh topic for this note".to_string())?;

        if topic.transport_id != transport_id {
            return Err("Transport instance is no longer active".to_string());
        }

        topic.sender
            .broadcast(Bytes::from(data))
            .await
            .map_err(|err| format!("Failed to broadcast iroh message: {err}"))
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
                                let _ = emit_message(
                                    &app_handle,
                                    &note_id_owned,
                                    &transport_id_owned,
                                    message.content.to_vec(),
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
) -> Result<String, String> {
    let mut runtime = state.runtime.lock().await;
    if runtime.is_none() {
        *runtime = Some(IrohRuntime::start().await?);
    }

    runtime
        .as_mut()
        .expect("runtime initialized")
        .host(&app, &note_id, &transport_id)
        .await
}

#[tauri::command]
pub async fn iroh_join(
    app: AppHandle,
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
    ticket: String,
) -> Result<(), String> {
    let mut runtime = state.runtime.lock().await;
    if runtime.is_none() {
        *runtime = Some(IrohRuntime::start().await?);
    }

    runtime
        .as_mut()
        .expect("runtime initialized")
        .join(&app, &note_id, &transport_id, &ticket)
        .await
}

#[tauri::command]
pub async fn iroh_send(
    state: tauri::State<'_, IrohState>,
    note_id: String,
    transport_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut runtime = state.runtime.lock().await;
    let runtime = runtime
        .as_mut()
        .ok_or_else(|| "Iroh transport is not initialized".to_string())?;
    runtime.send(&note_id, &transport_id, data).await
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
