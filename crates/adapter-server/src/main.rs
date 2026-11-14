//! Adapter v2 binary name, retained as a rollback alias. Both `jcode-adapter-v2`
//! and `jcode-adapter-v3` run the same versioned server.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    adapter_server::run_main().await
}
