use serde_json::{Map, Value};
use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::Instant,
};

#[derive(Clone, Default)]
pub(crate) struct SyncTrace(Option<Arc<Mutex<Map<String, Value>>>>);

tokio::task_local! {
    static TRACE: SyncTrace;
}

pub(crate) fn current() -> SyncTrace {
    TRACE.try_with(Clone::clone).unwrap_or_default()
}

impl SyncTrace {
    pub(super) fn new() -> Self {
        Self(Some(Arc::new(Mutex::new(Map::new()))))
    }

    pub(crate) async fn scope<T>(&self, future: impl Future<Output = T>) -> T {
        TRACE.scope(self.clone(), future).await
    }

    pub(crate) fn sync_scope<T>(&self, f: impl FnOnce() -> T) -> T {
        TRACE.sync_scope(self.clone(), f)
    }

    pub(crate) fn set(&self, key: &str, value: impl Into<Value>) {
        if let Some(fields) = &self.0 {
            fields.lock().unwrap().insert(key.into(), value.into());
        }
    }

    pub(crate) fn add(&self, key: &str, value: u64) {
        if let Some(fields) = &self.0 {
            let mut fields = fields.lock().unwrap();
            let previous = fields.get(key).and_then(Value::as_u64).unwrap_or(0);
            fields.insert(key.into(), (previous + value).into());
        }
    }

    /// Nested phase durations overlap; they must not be summed into a total.
    pub(crate) fn phase(&self, name: &'static str) -> Phase {
        self.set("last_stage", name);
        Phase {
            trace: self.clone(),
            name,
            started: Instant::now(),
        }
    }

    pub(super) fn fields(&self) -> Map<String, Value> {
        self.0
            .as_ref()
            .map(|fields| fields.lock().unwrap().clone())
            .unwrap_or_default()
    }

    pub(crate) fn record_failure(&self) {
        if let Some(fields) = &self.0 {
            let mut fields = fields.lock().unwrap();
            let stage = fields.get("last_stage").cloned().unwrap_or(Value::Null);
            fields.insert("last_failed_stage".into(), stage);
        }
    }
}

pub(crate) struct Phase {
    trace: SyncTrace,
    name: &'static str,
    started: Instant,
}

impl Drop for Phase {
    fn drop(&mut self) {
        self.trace.add(
            &format!("{}_ms", self.name),
            self.started.elapsed().as_millis() as u64,
        );
    }
}
