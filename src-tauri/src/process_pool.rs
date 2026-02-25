use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use chrono::{DateTime, Utc};
use tokio::sync::Semaphore;

#[derive(Clone, Debug)]
pub struct ProcessInfo {
    pub agent_id: String,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
}

pub struct ProcessPool {
    pub max_concurrent: usize,
    running: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    semaphore: Arc<Semaphore>,
}

impl ProcessPool {
    pub fn new(max: usize) -> Self {
        ProcessPool {
            max_concurrent: max,
            running: Arc::new(Mutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(max)),
        }
    }

    pub async fn acquire(&self) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
        self.semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Semaphore error: {e}"))
    }

    pub fn register(&self, agent_id: &str, pid: u32) {
        let mut running = self.running.lock().unwrap();
        running.insert(
            agent_id.to_string(),
            ProcessInfo {
                agent_id: agent_id.to_string(),
                pid,
                started_at: Utc::now(),
            },
        );
    }

    pub fn unregister(&self, agent_id: &str) {
        let mut running = self.running.lock().unwrap();
        running.remove(agent_id);
    }

    pub fn is_running(&self, agent_id: &str) -> bool {
        let running = self.running.lock().unwrap();
        running.contains_key(agent_id)
    }

    pub fn running_count(&self) -> usize {
        let running = self.running.lock().unwrap();
        running.len()
    }
}
