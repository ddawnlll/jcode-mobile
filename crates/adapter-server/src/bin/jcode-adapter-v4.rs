#[tokio::main]
async fn main() -> anyhow::Result<()> {
    adapter_server::run_main().await
}
