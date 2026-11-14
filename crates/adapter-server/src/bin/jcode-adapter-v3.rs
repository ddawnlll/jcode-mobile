//! Adapter v3 binary name. The implementation lives in `adapter_server::run_main`
//! so the v2 name can remain as a rollback alias during the migration window.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    adapter_server::run_main().await
}
