use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

pub struct HeartbeatScheduler {
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl HeartbeatScheduler {
    pub fn new() -> Self {
        HeartbeatScheduler {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_agent_heartbeat(
        &self,
        agent_id: String,
        interval_secs: u64,
        app_handle: AppHandle,
    ) {
        self.stop_agent_heartbeat(&agent_id);

        let id = agent_id.clone();
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(interval_secs)).await;

                let payload = serde_json::json!({
                    "agent_id": id,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });

                let _ = app_handle.emit("heartbeat-tick", payload);
            }
        });

        let mut handles = self.handles.lock().unwrap();
        handles.insert(agent_id, handle);
    }

    pub fn stop_agent_heartbeat(&self, agent_id: &str) {
        let mut handles = self.handles.lock().unwrap();
        if let Some(handle) = handles.remove(agent_id) {
            handle.abort();
        }
    }

    pub fn stop_all(&self) {
        let mut handles = self.handles.lock().unwrap();
        for (_, handle) in handles.drain() {
            handle.abort();
        }
    }
}
