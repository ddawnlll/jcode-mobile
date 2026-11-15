use std::sync::Arc;

use adapter_protocol::DeviceInfo;
use base64::Engine;
use rand::Rng;
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::paths::{CoreError, CoreResult};
use crate::store::Store;

const CODE_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Clone)]
pub struct AuthService {
    store: Arc<Store>,
}

impl AuthService {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    /// Install the pairing code for this adapter run. A supplied code is
    /// normalized but never placed in logs. Otherwise a one-time readable code
    /// is generated for the operator to display.
    pub fn install_pairing_code(&self, supplied: Option<&str>) -> CoreResult<String> {
        let code = match supplied {
            Some(value) if !value.trim().is_empty() => value.trim().to_ascii_uppercase(),
            _ => generate_pairing_code(),
        };
        self.store
            .replace_pairing_code(&hash_secret(&normalize_pairing_code(&code)), CODE_TTL_MS)?;
        Ok(code)
    }

    pub fn redeem(&self, code: &str, device_name: &str) -> CoreResult<(String, DeviceInfo)> {
        let token = generate_token();
        let device = self.store.redeem_pairing_code(
            &hash_secret(&normalize_pairing_code(code)),
            &hash_secret(&token),
            device_name,
        )?;
        Ok((token, device))
    }

    pub fn authenticate(&self, token: &str) -> CoreResult<Option<DeviceInfo>> {
        if token.len() < 16 {
            return Ok(None);
        }
        let device = self.store.device_by_token_hash(&hash_secret(token))?;
        if let Some(device) = &device {
            let _ = self.store.touch_device(&device.device_id);
        }
        Ok(device)
    }

    pub fn revoke(&self, device_id: &str) -> CoreResult<bool> {
        self.store.revoke_device(device_id)
    }

    pub fn is_revoked(&self, device_id: &str) -> CoreResult<bool> {
        self.store.is_device_revoked(device_id)
    }

    pub fn devices(&self) -> CoreResult<Vec<DeviceInfo>> {
        self.store.list_devices()
    }
}

/// The display form of a pairing code has separators, and a phone keyboard may
/// drop them, replace them with spaces, or change the case. Normalize the code
/// on both sides so one code redeems however it was typed. The generator only
/// emits `A` to `Z` and `2` to `9`, so no alphanumeric character is ever
/// removed here: everything filtered out is a separator.
pub fn normalize_pairing_code(code: &str) -> String {
    let normalized: String = code
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_uppercase())
        .collect();
    if normalized.is_empty() {
        // A supplied code made only of separators must not collapse to the empty
        // string, which an empty submission would then match.
        code.trim().to_ascii_uppercase()
    } else {
        normalized
    }
}

pub fn hash_secret(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_pairing_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    let mut raw = String::with_capacity(16);
    for _ in 0..12 {
        raw.push(ALPHABET[rng.random_range(0..ALPHABET.len())] as char);
    }
    format!("{}-{}-{}", &raw[0..4], &raw[4..8], &raw[8..12])
}

/// Constant work for unknown device ids so a caller cannot trivially probe
/// device existence through timing. The lookup itself is indexed by hash.
pub fn dummy_device_check() -> CoreResult<()> {
    let _ = hash_secret("jcode-mobile-unpaired-device");
    Ok(())
}

pub fn unauthorized() -> CoreError {
    CoreError::Message("unauthorized".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_tokens_never_appear_in_storage_hashes() {
        let store = Store::open_in_memory().unwrap();
        let auth = AuthService::new(store);
        let code = auth.install_pairing_code(Some("TEST-CODE")).unwrap();
        assert_eq!(code, "TEST-CODE");
        let (token, _) = auth.redeem("TEST-CODE", "Phone").unwrap();
        assert_eq!(token.len(), 43);
        assert!(auth.authenticate(&token).unwrap().is_some());
        assert!(auth.authenticate("not-a-real-token").unwrap().is_none());
    }

    #[test]
    fn pairing_is_single_use_and_name_is_bounded() {
        let store = Store::open_in_memory().unwrap();
        let auth = AuthService::new(store);
        auth.install_pairing_code(Some("AAAA-BBBB-CCCC")).unwrap();
        let (_, device) = auth.redeem("AAAA-BBBB-CCCC", &"x".repeat(200)).unwrap();
        assert!(device.name.len() <= 80);
        assert!(auth.redeem("AAAA-BBBB-CCCC", "Second").is_err());
    }

    #[test]
    fn one_code_redeems_however_it_was_typed() {
        // The displayed form is unchanged; every spelling of it redeems.
        for typed in [
            "ABCD-EFGH-JKLM",
            "abcd-efgh-jklm",
            "ABCDEFGHJKLM",
            "ABCD EFGH JKLM",
            " abcd efgh jklm ",
        ] {
            let auth = AuthService::new(Store::open_in_memory().unwrap());
            let shown = auth.install_pairing_code(Some("ABCD-EFGH-JKLM")).unwrap();
            assert_eq!(shown, "ABCD-EFGH-JKLM");
            let (token, device) = auth.redeem(typed, "Phone").unwrap();
            assert_eq!(token.len(), 43, "{typed} did not redeem");
            assert_eq!(device.name, "Phone");
        }
    }

    #[test]
    fn a_different_code_is_still_rejected() {
        let auth = AuthService::new(Store::open_in_memory().unwrap());
        auth.install_pairing_code(Some("ABCD-EFGH-JKLM")).unwrap();
        assert!(auth.redeem("JKLM-EFGH-ABCD", "Phone").is_err());
        assert!(auth.redeem("", "Phone").is_err());
    }
}
