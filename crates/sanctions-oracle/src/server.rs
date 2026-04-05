//! Sanctions Oracle HTTP server.
//!
//! Endpoints:
//!   GET  /health          — liveness check
//!   GET  /root            — current OFAC Merkle root + metadata
//!   GET  /witness?addr=0x — non-membership witness for an address
//!   GET  /check?addr=0x   — quick sanctioned/clean check
//!   POST /refresh         — re-fetch OFAC list and rebuild tree (auth required)

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

use crate::{
    extract_eth_addresses_from_xml, fetch_ofac_sdn, load_local_sdn,
    parse_eth_addresses, SanctionsMerkleTree,
};

// ── Shared state ──────────────────────────────────────────────��───────────────

pub struct OracleState {
    pub tree: SanctionsMerkleTree,
    pub updated_at: u64,
    pub address_count: usize,
    pub sdn_path: Option<String>,
    pub refresh_secret: Option<String>,
}

impl OracleState {
    pub fn build(sdn_path: Option<String>, refresh_secret: Option<String>) -> Result<Self> {
        let (addresses, _xml) = load_addresses(&sdn_path)?;
        let count = addresses.len();
        let tree = SanctionsMerkleTree::build(&addresses);
        let now = unix_now();
        info!(
            "Tree built: {} addresses, root=0x{}, depth={}",
            count,
            hex::encode(tree.root()),
            tree.depth
        );
        Ok(Self {
            tree,
            updated_at: now,
            address_count: count,
            sdn_path,
            refresh_secret,
        })
    }
}

fn load_addresses(sdn_path: &Option<String>) -> Result<(Vec<[u8; 32]>, String)> {
    let xml = match sdn_path {
        Some(path) => load_local_sdn(path)?,
        None => fetch_ofac_sdn()?,
    };
    let raw = extract_eth_addresses_from_xml(&xml);
    let addresses = parse_eth_addresses(&raw);
    Ok((addresses, xml))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddrQuery {
    addr: String,
}

#[derive(Deserialize)]
pub struct RefreshQuery {
    secret: Option<String>,
}

#[derive(Serialize)]
pub struct RootResponse {
    pub root: String,
    pub depth: u32,
    pub address_count: usize,
    pub updated_at: u64,
}

#[derive(Serialize)]
pub struct CheckResponse {
    pub address: String,
    pub sanctioned: bool,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Serialize)]
pub struct RefreshResponse {
    pub root: String,
    pub address_count: usize,
    pub updated_at: u64,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health() -> &'static str {
    "ok"
}

async fn get_root(State(state): State<Arc<RwLock<OracleState>>>) -> Json<RootResponse> {
    let s = state.read().await;
    Json(RootResponse {
        root: format!("0x{}", hex::encode(s.tree.root())),
        depth: s.tree.depth,
        address_count: s.address_count,
        updated_at: s.updated_at,
    })
}

async fn get_witness(
    State(state): State<Arc<RwLock<OracleState>>>,
    Query(q): Query<AddrQuery>,
) -> Result<Json<crate::NonMembershipWitness>, (StatusCode, Json<ErrorResponse>)> {
    let addr_bytes = parse_addr(&q.addr).map_err(|e| bad_request(e.to_string()))?;
    let timestamp = unix_now();
    let s = state.read().await;
    s.tree
        .non_membership_witness(&addr_bytes, timestamp)
        .map(Json)
        .map_err(|e| (StatusCode::FORBIDDEN, Json(ErrorResponse { error: e.to_string() })))
}

async fn check_address(
    State(state): State<Arc<RwLock<OracleState>>>,
    Query(q): Query<AddrQuery>,
) -> Result<Json<CheckResponse>, (StatusCode, Json<ErrorResponse>)> {
    let addr_bytes = parse_addr(&q.addr).map_err(|e| bad_request(e.to_string()))?;
    let s = state.read().await;
    Ok(Json(CheckResponse {
        address: q.addr,
        sanctioned: s.tree.is_sanctioned(&addr_bytes),
    }))
}

async fn refresh(
    State(state): State<Arc<RwLock<OracleState>>>,
    Query(q): Query<RefreshQuery>,
) -> Result<Json<RefreshResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Check secret
    {
        let s = state.read().await;
        if let Some(expected) = &s.refresh_secret {
            match &q.secret {
                None => return Err((StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                    error: "Missing ?secret=".into(),
                }))),
                Some(provided) if provided != expected => return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse { error: "Invalid secret".into() }),
                )),
                _ => {}
            }
        }
    }

    info!("Refreshing OFAC SDN list...");
    let sdn_path = state.read().await.sdn_path.clone();
    let (addresses, _) = load_addresses(&sdn_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() })))?;

    let count = addresses.len();
    let tree = SanctionsMerkleTree::build(&addresses);
    let now = unix_now();
    let root_hex = format!("0x{}", hex::encode(tree.root()));

    info!("Refreshed: {} addresses, root={}", count, root_hex);

    let mut s = state.write().await;
    s.tree = tree;
    s.address_count = count;
    s.updated_at = now;

    Ok(Json(RefreshResponse {
        root: root_hex,
        address_count: count,
        updated_at: now,
    }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_addr(s: &str) -> Result<[u8; 32]> {
    let s = s.trim().strip_prefix("0x").unwrap_or(s.trim());
    anyhow::ensure!(s.len() == 40, "Address must be 40 hex chars (20 bytes)");
    let mut bytes = [0u8; 20];
    hex::decode_to_slice(s, &mut bytes)?;
    let mut padded = [0u8; 32];
    padded[12..].copy_from_slice(&bytes);
    Ok(padded)
}

fn bad_request(msg: String) -> (StatusCode, Json<ErrorResponse>) {
    (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: msg }))
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn build_router(state: Arc<RwLock<OracleState>>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/root", get(get_root))
        .route("/witness", get(get_witness))
        .route("/check", get(check_address))
        .route("/refresh", post(refresh))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn run(bind: &str, state: Arc<RwLock<OracleState>>) -> Result<()> {
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!("Sanctions oracle listening on {}", bind);
    axum::serve(listener, app).await?;
    Ok(())
}
