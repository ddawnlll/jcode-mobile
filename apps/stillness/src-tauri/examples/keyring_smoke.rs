//! Native Secret Service probe.
//!
//! Run this on a Linux desktop session with an unlocked keyring to prove the
//! same `keyring` crate path the app uses can write, read, and delete one item:
//!
//! ```sh
//! DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
//!   cargo run --release --example keyring_smoke
//! ```
//!
//! It stores no app credential and deletes the probe item before exiting.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let entry = keyring::Entry::new("dev.jcode.stillness.smoke", "native-keyring-test")?;
    entry.set_password("device-token-smoke")?;
    let value = entry.get_password()?;
    assert_eq!(value, "device-token-smoke");
    entry.delete_credential()?;
    println!("keyring round trip ok");
    Ok(())
}
