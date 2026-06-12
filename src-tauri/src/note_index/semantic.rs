use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const MODEL_DIR: &str = "embedding-models/all-MiniLM-L6-v2";
pub(crate) const SEMANTIC_MODEL_ID: &str = "Qdrant/all-MiniLM-L6-v2-onnx";
pub(crate) const SEMANTIC_DIM: usize = 384;

type SharedTextEmbedding = Arc<Mutex<Option<TextEmbedding>>>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticEmbedding {
    pub(crate) model: String,
    pub(crate) dim: usize,
    pub(crate) vector: Vec<f32>,
}

pub(crate) struct SemanticEmbeddingState {
    model: SharedTextEmbedding,
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
    model: SharedTextEmbedding,
}

impl SemanticEmbeddingModelHandle {
    pub(crate) fn embed_passage(
        &self,
        app: &AppHandle,
        text: &str,
    ) -> Result<SemanticEmbedding, String> {
        self.embed(app, format!("passage: {text}"))
    }

    pub(crate) fn embed_query(
        &self,
        app: &AppHandle,
        query: &str,
    ) -> Result<SemanticEmbedding, String> {
        self.embed(app, format!("query: {query}"))
    }

    fn embed(&self, app: &AppHandle, text: String) -> Result<SemanticEmbedding, String> {
        let mut guard = self
            .model
            .lock()
            .map_err(|_| "semantic model mutex poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(load_model(app)?);
        }
        let model = guard
            .as_mut()
            .ok_or_else(|| "semantic model unavailable".to_string())?;
        let mut embeddings = model
            .embed(vec![text], None)
            .map_err(|e| format!("embed text: {e}"))?;
        let vector = embeddings
            .pop()
            .ok_or_else(|| "embedding model returned no vectors".to_string())?;
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
    }
}

fn load_model(app: &AppHandle) -> Result<TextEmbedding, String> {
    let dir = app
        .path()
        .resolve(MODEL_DIR, BaseDirectory::Resource)
        .map_err(|e| format!("resolve semantic model path: {e}"))?;

    let model = UserDefinedEmbeddingModel::new(
        read_model_file(&dir, "model.onnx")?,
        TokenizerFiles {
            tokenizer_file: read_model_file(&dir, "tokenizer.json")?,
            config_file: read_model_file(&dir, "config.json")?,
            special_tokens_map_file: read_model_file(&dir, "special_tokens_map.json")?,
            tokenizer_config_file: read_model_file(&dir, "tokenizer_config.json")?,
        },
    )
    .with_pooling(Pooling::Mean);

    TextEmbedding::try_new_from_user_defined(
        model,
        InitOptionsUserDefined::new().with_intra_threads(2),
    )
    .map_err(|e| format!("initialize semantic model: {e}"))
}

fn read_model_file(dir: &PathBuf, name: &str) -> Result<Vec<u8>, String> {
    let path = dir.join(name);
    std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

pub(crate) fn is_current_embedding(embedding: &SemanticEmbedding) -> bool {
    embedding.model == SEMANTIC_MODEL_ID
        && embedding.dim == SEMANTIC_DIM
        && embedding.vector.len() == SEMANTIC_DIM
}
