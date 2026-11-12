//! Mesures système pour le mode « Hacker » : processeur et mémoire de l'application.

use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

pub struct StatsState {
    sys: Mutex<System>,
    pid: Pid,
}

impl Default for StatsState {
    fn default() -> Self {
        let sys = System::new_with_specifics(RefreshKind::nothing());
        Self { sys: Mutex::new(sys), pid: Pid::from_u32(std::process::id()) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysStats {
    /// Processeur utilisé par MyIPTV (% d'un cœur, peut dépasser 100).
    process_cpu: f32,
    /// Processeur de la machine (% de l'ensemble des cœurs).
    system_cpu: f32,
    cores: usize,
    /// Mémoire résidente de MyIPTV (octets).
    process_memory: u64,
    total_memory: u64,
    used_memory: u64,
}

/// Mesure depuis l'appel précédent (le mode Hacker interroge chaque seconde).
#[tauri::command]
pub fn sys_stats(st: tauri::State<'_, StatsState>) -> SysStats {
    let mut sys = st.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[st.pid]), true, ProcessRefreshKind::nothing().with_cpu().with_memory());
    let (cpu, mem) = sys.process(st.pid).map(|p| (p.cpu_usage(), p.memory())).unwrap_or_default();
    SysStats {
        process_cpu: cpu,
        system_cpu: sys.global_cpu_usage(),
        cores: sys.cpus().len(),
        process_memory: mem,
        total_memory: sys.total_memory(),
        used_memory: sys.used_memory(),
    }
}
