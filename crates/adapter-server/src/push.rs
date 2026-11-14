//! Secure push delivery for completed turns, failures and approvals.
//!
//! The adapter is the only component that knows a turn finished while the phone
//! is closed. It stores a provider registration token per paired device and
//! sends a small FCM HTTP v1 message. Notification payloads never contain
//! transcript text, tool output, prompts, file contents or model names.
//!
//! Delivery requires operator credentials:
//!
//! - `JCODE_FCM_PROJECT_ID`
//! - `JCODE_FCM_ACCESS_TOKEN` (a short-lived OAuth access token with
//!   `firebase.messaging` scope, refreshed externally)
//!
//! Without both, `configured` is false, every send is counted as skipped, and
//! `push.status` reports `not_configured`. The adapter never claims delivery.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use adapter_core::{CoreError, CoreResult, PushRegistrationRow, Store, now_ms};
use adapter_protocol::{
    PushPreferencesRequest, PushRegisterPayload, PushRegisterRequest, PushRegistrationView,
    PushStatusPayload,
};
use serde_json::json;
use tokio::sync::RwLock;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushKind {
    Turns,
    Failures,
    Approvals,
}

impl PushKind {
    fn key(self) -> &'static str {
        match self {
            Self::Turns => "turns",
            Self::Failures => "failures",
            Self::Approvals => "approvals",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Turns => "Turn complete",
            Self::Failures => "Turn failed",
            Self::Approvals => "Approval needed",
        }
    }

    fn body(self) -> &'static str {
        match self {
            Self::Turns => "Your JCode session finished a turn.",
            Self::Failures => "A JCode turn stopped before completing.",
            Self::Approvals => "A tool is waiting for your approval.",
        }
    }

    fn channel(self) -> &'static str {
        match self {
            Self::Turns => "jcode_turns",
            Self::Failures => "jcode_failures",
            Self::Approvals => "jcode_approvals",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct FcmConfig {
    pub project_id: Option<String>,
    pub access_token: Option<String>,
    pub endpoint_override: Option<String>,
}

impl FcmConfig {
    pub fn from_env() -> Self {
        Self {
            project_id: std::env::var("JCODE_FCM_PROJECT_ID")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            access_token: std::env::var("JCODE_FCM_ACCESS_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            endpoint_override: std::env::var("JCODE_FCM_ENDPOINT")
                .ok()
                .filter(|value| !value.trim().is_empty()),
        }
    }

    pub fn configured(&self) -> bool {
        self.project_id.is_some() && self.access_token.is_some()
    }

    fn endpoint(&self) -> Option<String> {
        if let Some(endpoint) = self.endpoint_override.clone() {
            return Some(endpoint);
        }
        self.project_id.as_ref().map(|project| {
            format!("https://fcm.googleapis.com/v1/projects/{project}/messages:send")
        })
    }
}

pub struct PushService {
    store: Arc<Store>,
    config: FcmConfig,
    client: reqwest::Client,
    sent: AtomicU64,
    failed: AtomicU64,
    deduped: AtomicU64,
    skipped: AtomicU64,
    last_error: RwLock<Option<String>>,
    last_success_ms: RwLock<Option<i64>>,
}

impl std::fmt::Debug for PushService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PushService")
            .field("configured", &self.config.configured())
            .finish()
    }
}

impl PushService {
    pub fn new(store: Arc<Store>, config: FcmConfig) -> Arc<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Arc::new(Self {
            store,
            config,
            client,
            sent: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            deduped: AtomicU64::new(0),
            skipped: AtomicU64::new(0),
            last_error: RwLock::new(None),
            last_success_ms: RwLock::new(None),
        })
    }

    pub fn configured(&self) -> bool {
        self.config.configured()
    }

    pub fn provider(&self) -> &'static str {
        "fcm_http_v1"
    }

    fn view(row: &PushRegistrationRow) -> PushRegistrationView {
        let suffix: String = {
            let chars: Vec<char> = row.token.chars().collect();
            let start = chars.len().saturating_sub(6);
            chars[start..].iter().collect()
        };
        PushRegistrationView {
            device_id: row.device_id.clone(),
            platform: row.platform.clone(),
            token_suffix: suffix,
            enabled: row.enabled,
            turns: row.turns,
            failures: row.failures,
            approvals: row.approvals,
            app_version: row.app_version.clone(),
            updated_at_ms: row.updated_at_ms,
        }
    }

    pub fn register(
        &self,
        device_id: &str,
        request: &PushRegisterRequest,
    ) -> CoreResult<PushRegisterPayload> {
        let platform = request.platform.trim().to_ascii_lowercase();
        if !matches!(platform.as_str(), "android" | "ios") {
            return Err(CoreError::InvalidInput(
                "platform must be android or ios".into(),
            ));
        }
        let token = request.token.trim();
        if token.len() < 8 || token.len() > 4096 {
            return Err(CoreError::InvalidInput(
                "push token length is out of range".into(),
            ));
        }
        let row = self.store.upsert_push_registration(
            device_id,
            &platform,
            token,
            request.app_version.as_deref(),
            request.enabled,
        )?;
        info!(
            device = device_id,
            configured = self.configured(),
            "push registration stored"
        );
        Ok(PushRegisterPayload {
            registered: true,
            provider: self.provider().into(),
            configured: self.configured(),
            registration: Some(Self::view(&row)),
        })
    }

    pub fn unregister(&self, device_id: &str) -> CoreResult<bool> {
        self.store.delete_push_registration(device_id)
    }

    pub fn set_preferences(
        &self,
        device_id: &str,
        request: &PushPreferencesRequest,
    ) -> CoreResult<PushRegisterPayload> {
        let row = self.store.set_push_preferences(
            device_id,
            request.enabled,
            request.turns,
            request.failures,
            request.approvals,
        )?;
        Ok(PushRegisterPayload {
            registered: true,
            provider: self.provider().into(),
            configured: self.configured(),
            registration: Some(Self::view(&row)),
        })
    }

    pub fn status(&self) -> PushStatusPayload {
        PushStatusPayload {
            provider: self.provider().into(),
            configured: self.configured(),
            registrations: self.store.push_registration_count().unwrap_or(0),
            sent: self.sent.load(Ordering::Relaxed),
            failed: self.failed.load(Ordering::Relaxed),
            deduped: self.deduped.load(Ordering::Relaxed),
            skipped: self.skipped.load(Ordering::Relaxed),
            last_error: self
                .last_error
                .try_read()
                .ok()
                .and_then(|value| value.clone()),
            last_success_ms: self
                .last_success_ms
                .try_read()
                .ok()
                .and_then(|value| *value),
        }
    }

    /// Queue notifications for a finished turn, failure or approval. Never
    /// blocks the session event path: delivery runs on a Tokio task.
    pub fn notify(self: &Arc<Self>, kind: PushKind, session_id: &str, event_id: Option<&str>) {
        let targets = match self.store.push_targets(kind.key()) {
            Ok(targets) => targets,
            Err(error) => {
                warn!(%error, "push target lookup failed");
                return;
            }
        };
        if targets.is_empty() {
            return;
        }
        let session = session_id.to_string();
        let event = event_id.unwrap_or("latest").to_string();
        for target in targets {
            let key = format!("{}:{session}:{event}", kind.key());
            match self
                .store
                .claim_push_notification(&key, &target.device_id, &session, kind.key())
            {
                Ok(true) => {}
                Ok(false) => {
                    self.deduped.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
                Err(error) => {
                    warn!(%error, "push dedupe claim failed");
                    continue;
                }
            }
            if !self.configured() {
                self.skipped.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut last) = self.last_error.try_write() {
                    *last = Some("push provider is not configured".into());
                }
                continue;
            }
            let service = Arc::clone(self);
            let session_for_task = session.clone();
            let event_for_task = event.clone();
            tokio::spawn(async move {
                service
                    .deliver(kind, &target, &session_for_task, &event_for_task)
                    .await;
            });
        }
    }

    fn payload(kind: PushKind, session_id: &str, event_id: &str) -> serde_json::Value {
        json!({
            "message": {
                "token": "",
                "notification": {
                    "title": kind.title(),
                    "body": kind.body()
                },
                "data": {
                    "session_id": session_id,
                    "event_id": event_id,
                    "kind": kind.key(),
                    "deep_link": format!("jcode://session/{session_id}")
                },
                "android": {
                    "priority": "high",
                    "notification": {
                        "channel_id": kind.channel(),
                        "tag": format!("jcode-{}-{session_id}", kind.key())
                    }
                }
            }
        })
    }

    async fn deliver(
        &self,
        kind: PushKind,
        target: &PushRegistrationRow,
        session_id: &str,
        event_id: &str,
    ) {
        let Some(endpoint) = self.config.endpoint() else {
            self.skipped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let Some(token) = self.config.access_token.clone() else {
            self.skipped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let mut payload = Self::payload(kind, session_id, event_id);
        payload["message"]["token"] = json!(target.token);
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                self.sent.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut last) = self.last_success_ms.try_write() {
                    *last = Some(now_ms());
                }
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                let body: String = body.chars().take(240).collect();
                self.failed.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut last) = self.last_error.try_write() {
                    *last = Some(format!("fcm {status}: {body}"));
                }
                warn!(%status, device = %target.device_id, "push delivery rejected");
            }
            Err(error) => {
                self.failed.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut last) = self.last_error.try_write() {
                    *last = Some(format!("fcm request failed: {error}"));
                }
                warn!(%error, device = %target.device_id, "push delivery failed");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adapter_protocol::PushPreferencesRequest;

    fn service() -> (Arc<PushService>, Arc<Store>) {
        let store = Store::open_in_memory().unwrap();
        let service = PushService::new(Arc::clone(&store), FcmConfig::default());
        (service, store)
    }

    fn request(token: &str) -> PushRegisterRequest {
        PushRegisterRequest {
            platform: "android".into(),
            token: token.into(),
            app_version: Some("0.4.0".into()),
            enabled: true,
        }
    }

    #[test]
    fn registration_masks_the_token() {
        let (service, store) = service();
        let payload = service
            .register("dev_1", &request("fcm_token_abcdef123456"))
            .unwrap();
        assert!(payload.registered);
        assert!(!payload.configured);
        let view = payload.registration.unwrap();
        assert_eq!(view.token_suffix, "123456");
        assert!(!view.token_suffix.contains("abcdef"));
        assert_eq!(store.push_registration_count().unwrap(), 1);
    }

    #[test]
    fn invalid_registrations_are_rejected() {
        let (service, _) = service();
        let mut bad = request("short");
        assert!(service.register("dev_1", &bad).is_err());
        bad.token = "long_enough_token".into();
        bad.platform = "desktop".into();
        assert!(service.register("dev_1", &bad).is_err());
    }

    #[test]
    fn preferences_filter_targets() {
        let (service, store) = service();
        service
            .register("dev_1", &request("fcm_token_abcdef123456"))
            .unwrap();
        service
            .set_preferences(
                "dev_1",
                &PushPreferencesRequest {
                    enabled: true,
                    turns: true,
                    failures: false,
                    approvals: false,
                },
            )
            .unwrap();
        assert_eq!(store.push_targets("turns").unwrap().len(), 1);
        assert!(store.push_targets("failures").unwrap().is_empty());
        assert!(store.push_targets("approvals").unwrap().is_empty());
        assert!(store.push_targets("everything").is_err());
    }

    #[test]
    fn dedupe_is_per_device_and_key() {
        let store = Store::open_in_memory().unwrap();
        assert!(
            store
                .claim_push_notification("turns:s1:t1", "dev_1", "s1", "turns")
                .unwrap()
        );
        assert!(
            !store
                .claim_push_notification("turns:s1:t1", "dev_1", "s1", "turns")
                .unwrap()
        );
        assert!(
            store
                .claim_push_notification("turns:s1:t1", "dev_2", "s1", "turns")
                .unwrap()
        );
    }

    #[test]
    fn unconfigured_notify_is_skipped_not_claimed_as_sent() {
        let (service, _) = service();
        service
            .register("dev_1", &request("fcm_token_abcdef123456"))
            .unwrap();
        service.notify(PushKind::Turns, "session_1", Some("turn_1"));
        service.notify(PushKind::Turns, "session_1", Some("turn_1"));
        let status = service.status();
        assert_eq!(status.sent, 0);
        assert_eq!(status.failed, 0);
        assert_eq!(status.skipped, 1, "unconfigured delivery is skipped once");
        assert_eq!(status.deduped, 1, "the second identical event is deduped");
        assert!(!status.configured);
    }

    #[test]
    fn payload_contains_no_transcript_content() {
        let payload = PushService::payload(PushKind::Approvals, "session_1", "req_1");
        let data = &payload["message"]["data"];
        assert_eq!(data["session_id"], "session_1");
        assert_eq!(data["deep_link"], "jcode://session/session_1");
        assert_eq!(data["kind"], "approvals");
        let text = payload.to_string();
        assert!(!text.contains("prompt"));
        assert!(!text.contains("output"));
    }
}
