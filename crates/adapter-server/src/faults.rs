//! Opt-in failure injection for adapter conformance and chaos tests.
//!
//! Disabled unless `JCODE_ADAPTER_FAULTS` names a rule. Rules are explicit and
//! observable in `diagnostics.snapshot`; nothing here can be triggered by a
//! remote client.

use std::time::Duration;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FaultInjection {
    /// Adds latency before dispatching a prompt.
    pub delay_dispatch_ms: Option<u64>,
    /// Adds latency before answering an event replay.
    pub delay_replay_ms: Option<u64>,
    /// Makes the journal append fail, exercising the degraded path.
    pub journal_fail: bool,
    /// Makes backend calls fail with a backend-unavailable error.
    pub backend_unavailable: bool,
}

impl FaultInjection {
    /// Parse `JCODE_ADAPTER_FAULTS`. Unknown rules are ignored, not guessed.
    pub fn from_env() -> Self {
        Self::parse(&std::env::var("JCODE_ADAPTER_FAULTS").unwrap_or_default())
    }

    pub fn parse(value: &str) -> Self {
        let mut faults = Self::default();
        for rule in value.split(',').map(str::trim).filter(|r| !r.is_empty()) {
            if rule == "journal_fail" {
                faults.journal_fail = true;
            } else if rule == "backend_unavailable" {
                faults.backend_unavailable = true;
            } else if let Some(raw) = rule.strip_prefix("delay_dispatch_ms=") {
                faults.delay_dispatch_ms = raw.parse::<u64>().ok().map(|ms| ms.min(60_000));
            } else if let Some(raw) = rule.strip_prefix("delay_replay_ms=") {
                faults.delay_replay_ms = raw.parse::<u64>().ok().map(|ms| ms.min(60_000));
            }
        }
        faults
    }

    pub fn enabled(&self) -> bool {
        self.delay_dispatch_ms.is_some()
            || self.delay_replay_ms.is_some()
            || self.journal_fail
            || self.backend_unavailable
    }

    pub fn rules(&self) -> Vec<String> {
        let mut rules = Vec::new();
        if let Some(ms) = self.delay_dispatch_ms {
            rules.push(format!("delay_dispatch_ms={ms}"));
        }
        if let Some(ms) = self.delay_replay_ms {
            rules.push(format!("delay_replay_ms={ms}"));
        }
        if self.journal_fail {
            rules.push("journal_fail".into());
        }
        if self.backend_unavailable {
            rules.push("backend_unavailable".into());
        }
        rules
    }

    pub fn dispatch_delay(&self) -> Option<Duration> {
        self.delay_dispatch_ms.map(Duration::from_millis)
    }

    pub fn replay_delay(&self) -> Option<Duration> {
        self.delay_replay_ms.map(Duration::from_millis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_value_disables_everything() {
        let faults = FaultInjection::parse("");
        assert!(!faults.enabled());
        assert!(faults.rules().is_empty());
    }

    #[test]
    fn rules_parse_and_are_reported() {
        let faults = FaultInjection::parse("delay_dispatch_ms=250,journal_fail,unknown");
        assert_eq!(faults.delay_dispatch_ms, Some(250));
        assert!(faults.journal_fail);
        assert!(faults.enabled());
        assert_eq!(
            faults.rules(),
            vec![
                "delay_dispatch_ms=250".to_string(),
                "journal_fail".to_string()
            ]
        );
    }

    #[test]
    fn delay_is_clamped() {
        let faults = FaultInjection::parse("delay_replay_ms=999999");
        assert_eq!(faults.delay_replay_ms, Some(60_000));
    }
}
