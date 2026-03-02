use std::fs;
use chrono::{Local, Duration};

use crate::db::Database;
use crate::models::Agent;

pub fn build_report(agent: &Agent, db: &Database) -> Result<String, String> {
    let today = Local::now().date_naive();
    let reports_dir = format!("{}/.founder/reports", agent.workspace.trim_end_matches('/'));
    let report_path = format!("{}/{}.md", reports_dir, today);

    if let Ok(existing) = fs::read_to_string(&report_path) {
        return Ok(existing);
    }

    let sessions = db.get_work_sessions(&agent.id)?;

    let yesterday = today - Duration::days(1);
    let recent: Vec<_> = sessions.iter().filter(|s| {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s.started_at) {
            dt.date_naive() >= yesterday && dt.date_naive() <= today
        } else {
            false
        }
    }).collect();

    let total_sessions = recent.len();
    let total_turns: u32 = recent.iter().map(|s| s.turns).sum();
    let total_cost: f64 = recent.iter().map(|s| s.cost_usd).sum();
    let total_input: u64 = recent.iter().map(|s| s.input_tokens).sum();
    let total_output: u64 = recent.iter().map(|s| s.output_tokens).sum();

    let mut outcomes: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for s in &recent {
        *outcomes.entry(format!("{:?}", s.outcome)).or_insert(0) += 1;
    }

    let summaries: Vec<String> = recent.iter()
        .filter(|s| !s.summary.is_empty() && s.summary != "No result")
        .map(|s| format!("- {}", s.summary.lines().next().unwrap_or(&s.summary)))
        .take(10)
        .collect();

    let report = format!(
        "# Daily Report — {}\n\n\
         **Co-founder**: {}\n\n\
         ## Summary\n\n\
         | Metric | Value |\n\
         |--------|-------|\n\
         | Sessions | {} |\n\
         | Total turns | {} |\n\
         | Tokens (in/out) | {}k / {}k |\n\
         | Cost | ${:.2} |\n\n\
         ## Outcomes\n\n\
         {}\n\n\
         ## Session Highlights\n\n\
         {}\n",
        today,
        agent.name,
        total_sessions,
        total_turns,
        total_input / 1000,
        total_output / 1000,
        total_cost,
        if outcomes.is_empty() { "No sessions recorded.".to_string() }
        else { outcomes.iter().map(|(k, v)| format!("- **{}**: {}", k, v)).collect::<Vec<_>>().join("\n") },
        if summaries.is_empty() { "No highlights.".to_string() }
        else { summaries.join("\n") },
    );

    fs::create_dir_all(&reports_dir)
        .map_err(|e| format!("Failed to create reports dir: {e}"))?;
    fs::write(&report_path, &report)
        .map_err(|e| format!("Failed to write report: {e}"))?;

    Ok(report)
}

pub fn should_generate_report(agent: &Agent) -> bool {
    let today = Local::now().date_naive();
    let reports_dir = format!("{}/.founder/reports", agent.workspace.trim_end_matches('/'));
    let report_path = format!("{}/{}.md", reports_dir, today);
    !std::path::Path::new(&report_path).exists()
}

pub fn is_report_hour() -> bool {
    let hour = Local::now().format("%H").to_string().parse::<u8>().unwrap_or(0);
    hour == 8
}
