//! Sanctions Oracle HTTP server entrypoint.
//!
//! Usage:
//!   sanctions-server --bind 0.0.0.0:8090
//!   sanctions-server --bind 0.0.0.0:8090 --sdn-file /root/sdn_advanced.xml
//!   sanctions-server --bind 0.0.0.0:8090 --refresh-secret mysecret

use std::sync::Arc;
use anyhow::Result;
use clap::Parser;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

use sanctions_oracle::server::{OracleState, run};

#[derive(Parser)]
#[command(name = "sanctions-server", about = "OFAC SDN Merkle oracle HTTP server")]
struct Args {
    /// Bind address (default: 0.0.0.0:8090)
    #[arg(long, default_value = "0.0.0.0:8090")]
    bind: String,

    /// Path to local SDN XML file (skips HTTP fetch on startup)
    #[arg(long)]
    sdn_file: Option<String>,

    /// Secret token for POST /refresh endpoint (optional)
    #[arg(long)]
    refresh_secret: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("sanctions_oracle=info".parse()?))
        .init();

    let args = Args::parse();

    tracing::info!("Building OFAC sanctions Merkle tree...");
    let state = OracleState::build(args.sdn_file, args.refresh_secret)?;
    let shared = Arc::new(RwLock::new(state));

    run(&args.bind, shared).await
}
