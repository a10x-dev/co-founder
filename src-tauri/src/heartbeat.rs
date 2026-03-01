use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

pub struct HeartbeatScheduler {
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    intervals: Arc<Mutex<HashMap<String, u64>>>,
}

impl HeartbeatScheduler {
    pub fn new() -> Self {
        HeartbeatScheduler {
            handles: Arc::new(Mutex::new(HashMap::new())),
            intervals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_agent_heartbeat(
        &self,
        agent_id: String,
        interval_secs: u64,
        app_handle: AppHandle,
    ) {
        self.stop_agent_heartbeat(&agent_id);

        {
            let mut intervals = self.intervals.lock().unwrap();
            intervals.insert(agent_id.clone(), interval_secs);
        }

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

    /// Restart heartbeat with a new interval (agent-requested tempo change)
    pub fn update_interval(
        &self,
        agent_id: &str,
        new_interval_secs: u64,
        app_handle: AppHandle,
    ) {
        let current = {
            let intervals = self.intervals.lock().unwrap();
            intervals.get(agent_id).copied()
        };

        if current == Some(new_interval_secs) {
            return;
        }

        self.start_agent_heartbeat(agent_id.to_string(), new_interval_secs, app_handle);
    }

    pub fn get_interval(&self, agent_id: &str) -> Option<u64> {
        let intervals = self.intervals.lock().unwrap();
        intervals.get(agent_id).copied()
    }

    pub fn stop_agent_heartbeat(&self, agent_id: &str) {
        let mut handles = self.handles.lock().unwrap();
        if let Some(handle) = handles.remove(agent_id) {
            handle.abort();
        }
        let mut intervals = self.intervals.lock().unwrap();
        intervals.remove(agent_id);
    }

    pub fn stop_all(&self) {
        let mut handles = self.handles.lock().unwrap();
        for (_, handle) in handles.drain() {
            handle.abort();
        }
        let mut intervals = self.intervals.lock().unwrap();
        intervals.clear();
    }
}
