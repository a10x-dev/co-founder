use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use chrono::{DateTime, Utc};
use tokio::sync::Semaphore;

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct ProcessInfo {
    pub agent_id: String,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
}

pub struct ProcessPool {
    max_concurrent: Arc<AtomicUsize>,
    permit_debt: Arc<AtomicUsize>,
    running: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    pending: Arc<Mutex<HashSet<String>>>,
    semaphore: Arc<Semaphore>,
}

impl ProcessPool {
    pub fn new(max: usize) -> Self {
        ProcessPool {
            max_concurrent: Arc::new(AtomicUsize::new(max)),
            permit_debt: Arc::new(AtomicUsize::new(0)),
            running: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashSet::new())),
            semaphore: Arc::new(Semaphore::new(max)),
        }
    }

    pub fn max_concurrent(&self) -> usize {
        self.max_concurrent.load(Ordering::Relaxed)
    }

    pub fn update_max_concurrent(&self, new_max: usize) {
        let normalized = new_max.max(1);
        let old = self.max_concurrent.swap(normalized, Ordering::Relaxed);
        if normalized > old {
            let mut to_add = normalized - old;

            // If we previously lowered the cap while all permits were in use,
            // consume growth against pending shrink debt first.
            let debt = self.permit_debt.load(Ordering::Relaxed);
            if debt > 0 {
                let clear = to_add.min(debt);
                if clear > 0 {
                    self.permit_debt.fetch_sub(clear, Ordering::Relaxed);
                    to_add -= clear;
                }
            }

            if to_add > 0 {
                self.semaphore.add_permits(to_add);
            }
        } else if normalized < old {
            let to_remove = old - normalized;
            let removed = self.semaphore.forget_permits(to_remove);
            if removed < to_remove {
                self.permit_debt
                    .fetch_add(to_remove - removed, Ordering::Relaxed);
            }
        }
    }

    pub fn try_acquire(&self) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
        self.reconcile_permit_debt();
        self.semaphore
            .clone()
            .try_acquire_owned()
            .map_err(|_| "No available slots".to_string())
    }

    fn reconcile_permit_debt(&self) {
        let debt = self.permit_debt.load(Ordering::Relaxed);
        if debt == 0 {
            return;
        }

        let removed = self.semaphore.forget_permits(debt);
        if removed > 0 {
            self.permit_debt.fetch_sub(removed, Ordering::Relaxed);
        }
    }

    pub fn mark_pending(&self, agent_id: &str) -> bool {
        let mut pending = self.pending.lock().unwrap();
        pending.insert(agent_id.to_string())
    }

    pub fn clear_pending(&self, agent_id: &str) {
        let mut pending = self.pending.lock().unwrap();
        pending.remove(agent_id);
    }

    pub fn is_busy(&self, agent_id: &str) -> bool {
        let running = self.running.lock().unwrap();
        if running.contains_key(agent_id) {
            return true;
        }
        drop(running);
        let pending = self.pending.lock().unwrap();
        pending.contains(agent_id)
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

    pub fn kill_agent(&self, agent_id: &str) -> Result<(), String> {
        self.clear_pending(agent_id);

        let pid = {
            let running = self.running.lock().unwrap();
            running.get(agent_id).map(|p| p.pid)
        };

        if let Some(pid) = pid {
            kill_pid(pid)?;
            self.unregister(agent_id);
        }

        Ok(())
    }

    pub fn kill_all(&self) -> Result<(), String> {
        {
            let mut pending = self.pending.lock().unwrap();
            pending.clear();
        }

        let running_agents: Vec<(String, u32)> = {
            let running = self.running.lock().unwrap();
            running
                .iter()
                .map(|(agent_id, info)| (agent_id.clone(), info.pid))
                .collect()
        };

        for (agent_id, pid) in running_agents {
            kill_pid(pid)?;
            self.unregister(&agent_id);
        }

        Ok(())
    }
}

#[cfg(unix)]
fn kill_pid(pid: u32) -> Result<(), String> {
    let ret = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if ret == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to send SIGTERM to pid {pid}: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
fn kill_pid(pid: u32) -> Result<(), String> {
    use std::process::Command;
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .status()
        .map_err(|e| format!("Failed to kill pid {pid}: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill failed for pid {pid}"))
    }
}
