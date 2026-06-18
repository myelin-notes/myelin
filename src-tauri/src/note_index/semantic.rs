use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{Arc, Mutex};

use candle_core::{Device, Tensor, D};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokenizers::{Tokenizer, TruncationDirection, TruncationParams, TruncationStrategy};

const MODEL_DIR: &str = "embedding-models/all-MiniLM-L6-v2";
pub(crate) const SEMANTIC_MODEL_ID: &str = "sentence-transformers/all-MiniLM-L6-v2";
pub(crate) const SEMANTIC_DIM: usize = 384;
const MAX_TOKENS: usize = 512;

struct EmbeddingModel {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl EmbeddingModel {
    fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("tokenize text: {e}"))?;

        let ids = encoding.get_ids();
        if ids.is_empty() {
            return Err("tokenizer produced no tokens".to_string());
        }
        let mask = encoding.get_attention_mask();

        let input_ids = Tensor::new(ids, &self.device)
            .and_then(|t| t.unsqueeze(0))
            .map_err(|e| format!("build input tensor: {e}"))?;
        let token_type_ids = input_ids
            .zeros_like()
            .map_err(|e| format!("build token type tensor: {e}"))?;
        let attention_mask = Tensor::new(mask, &self.device)
            .and_then(|t| t.unsqueeze(0))
            .map_err(|e| format!("build attention tensor: {e}"))?;

        let hidden = self
            .model
            .forward(&input_ids, &token_type_ids, Some(&attention_mask))
            .map_err(|e| format!("model forward: {e}"))?;

        mean_pool_normalize(&hidden, &attention_mask).map_err(|e| format!("pool embedding: {e}"))
    }
}

/// Attention-masked mean pooling followed by L2 normalization, matching the
/// sentence-transformers reference behavior for all-MiniLM-L6-v2.
fn mean_pool_normalize(hidden: &Tensor, attention_mask: &Tensor) -> candle_core::Result<Vec<f32>> {
    // hidden: [1, seq, hidden]; attention_mask: [1, seq]
    let mask = attention_mask.to_dtype(hidden.dtype())?.unsqueeze(2)?; // [1, seq, 1]
    let summed = hidden.broadcast_mul(&mask)?.sum(1)?; // [1, hidden]
    let counts = mask.sum(1)?; // [1, 1]
    let mean = summed.broadcast_div(&counts)?; // [1, hidden]
    let norm = mean.sqr()?.sum_keepdim(D::Minus1)?.sqrt()?; // [1, 1]
    let normalized = mean.broadcast_div(&norm)?;
    normalized.squeeze(0)?.to_vec1()
}

type SharedModel = Arc<Mutex<Option<EmbeddingModel>>>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticEmbedding {
    pub(crate) model: String,
    pub(crate) dim: usize,
    pub(crate) vector: Vec<f32>,
}

pub(crate) struct SemanticEmbeddingState {
    model: SharedModel,
}

impl SemanticEmbeddingState {
    pub(crate) fn new() -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn clone_model_handle(&self) -> SemanticEmbeddingModelHandle {
        SemanticEmbeddingModelHandle {
            model: self.model.clone(),
        }
    }
}

impl Default for SemanticEmbeddingState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub(crate) struct SemanticEmbeddingModelHandle {
    model: SharedModel,
}

impl SemanticEmbeddingModelHandle {
    pub(crate) fn embed_passage(
        &self,
        app: &AppHandle,
        text: &str,
    ) -> Result<SemanticEmbedding, String> {
        self.embed(app, text)
    }

    pub(crate) fn embed_query(
        &self,
        app: &AppHandle,
        query: &str,
    ) -> Result<SemanticEmbedding, String> {
        self.embed(app, query)
    }

    fn embed(&self, app: &AppHandle, text: &str) -> Result<SemanticEmbedding, String> {
        let mut guard = match self.model.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                self.model.clear_poison();
                guard
            }
        };

        let result = catch_unwind(AssertUnwindSafe(|| {
            if guard.is_none() {
                *guard = Some(load_model(app)?);
            }
            let model = guard
                .as_ref()
                .ok_or_else(|| "semantic model unavailable".to_string())?;
            let vector = model.embed(text)?;
            if vector.len() != SEMANTIC_DIM {
                return Err(format!(
                    "unexpected embedding dimension: got {}, expected {SEMANTIC_DIM}",
                    vector.len()
                ));
            }
            Ok(SemanticEmbedding {
                model: SEMANTIC_MODEL_ID.to_string(),
                dim: SEMANTIC_DIM,
                vector,
            })
        }));

        match result {
            Ok(result) => result,
            Err(panic) => {
                *guard = None;
                Err(format!(
                    "semantic embedding panicked: {}",
                    panic_payload_message(panic)
                ))
            }
        }
    }
}

fn load_model(app: &AppHandle) -> Result<EmbeddingModel, String> {
    let dir = app
        .path()
        .resolve(MODEL_DIR, BaseDirectory::Resource)
        .map_err(|e| format!("resolve semantic model path: {e}"))?;
    load_model_from_dir(&dir)
}

fn load_model_from_dir(dir: &Path) -> Result<EmbeddingModel, String> {
    let config: Config = serde_json::from_slice(&read_model_file(dir, "config.json")?)
        .map_err(|e| format!("parse model config: {e}"))?;

    let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
        .map_err(|e| format!("load tokenizer: {e}"))?;
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: MAX_TOKENS,
            strategy: TruncationStrategy::LongestFirst,
            stride: 0,
            direction: TruncationDirection::Right,
        }))
        .map_err(|e| format!("configure tokenizer truncation: {e}"))?;

    let device = Device::Cpu;
    let weights = dir.join("model.safetensors");
    // SAFETY: the weights file is a bundled, read-only application resource.
    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&[weights], DTYPE, &device)
            .map_err(|e| format!("load model weights: {e}"))?
    };
    let model = BertModel::load(vb, &config).map_err(|e| format!("initialize model: {e}"))?;

    Ok(EmbeddingModel {
        model,
        tokenizer,
        device,
    })
}

fn read_model_file(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    let path = dir.join(name);
    std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

fn panic_payload_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
}

pub(crate) fn is_current_embedding(embedding: &SemanticEmbedding) -> bool {
    embedding.model == SEMANTIC_MODEL_ID
        && embedding.dim == SEMANTIC_DIM
        && embedding.vector.len() == SEMANTIC_DIM
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test for the bundled model files: they must load and produce
    /// embeddings that rank related text above unrelated text.
    #[test]
    fn bundled_model_embeds_and_ranks_related_text_higher() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(MODEL_DIR);
        let model = load_model_from_dir(&dir).unwrap();

        let cat = model.embed("the cat sat on the mat").unwrap();
        let kitten = model.embed("a kitten rests on a rug").unwrap();
        let report = model
            .embed("quarterly financial report for shareholders")
            .unwrap();
        for v in [&cat, &kitten, &report] {
            assert_eq!(v.len(), SEMANTIC_DIM);
        }

        let related = cosine(&cat, &kitten);
        let unrelated = cosine(&cat, &report);
        assert!(
            related > unrelated,
            "related {related} should outrank unrelated {unrelated}"
        );
    }

    fn cosine(left: &[f32], right: &[f32]) -> f32 {
        let dot: f32 = left.iter().zip(right).map(|(a, b)| a * b).sum();
        let left_norm: f32 = left.iter().map(|a| a * a).sum::<f32>().sqrt();
        let right_norm: f32 = right.iter().map(|b| b * b).sum::<f32>().sqrt();
        dot / (left_norm * right_norm)
    }
}
