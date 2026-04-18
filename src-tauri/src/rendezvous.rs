use pkarr::{Client, Keypair, SignedPacket, dns::rdata::RData};
use sha2::{Digest, Sha256};

const RENDEZVOUS_SALT: &[u8] = b"myelin-rendezvous-v1";
const TICKET_RECORD: &str = "_ticket";
const RECORD_TTL_SECS: u32 = 1800;

pub struct Rendezvous {
    client: Client,
}

impl Rendezvous {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .build()
            .map_err(|err| format!("Failed to build pkarr client: {err}"))?;
        Ok(Self { client })
    }

    pub async fn publish(&self, note_id: &str, ticket: &str) -> Result<(), String> {
        let keypair = derive_keypair(note_id);
        let packet = SignedPacket::builder()
            .txt(
                TICKET_RECORD
                    .try_into()
                    .map_err(|err| format!("Invalid record name: {err}"))?,
                ticket
                    .try_into()
                    .map_err(|err| format!("Ticket too large for TXT: {err}"))?,
                RECORD_TTL_SECS,
            )
            .sign(&keypair)
            .map_err(|err| format!("Failed to sign rendezvous packet: {err}"))?;

        self.client
            .publish(&packet, None)
            .await
            .map_err(|err| format!("Failed to publish rendezvous: {err}"))
    }

    pub async fn resolve(&self, note_id: &str) -> Result<Option<String>, String> {
        let keypair = derive_keypair(note_id);
        let public_key = keypair.public_key();

        let Some(packet) = self.client.resolve(&public_key).await else {
            return Ok(None);
        };

        for record in packet.resource_records(TICKET_RECORD) {
            if let RData::TXT(txt) = &record.rdata {
                if let Ok(s) = String::try_from(txt.clone()) {
                    if !s.is_empty() {
                        return Ok(Some(s));
                    }
                }
            }
        }
        Ok(None)
    }
}

fn derive_keypair(note_id: &str) -> Keypair {
    let mut hasher = Sha256::new();
    hasher.update(RENDEZVOUS_SALT);
    hasher.update(note_id.as_bytes());
    let digest = hasher.finalize();
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&digest);
    Keypair::from_secret_key(&seed)
}
