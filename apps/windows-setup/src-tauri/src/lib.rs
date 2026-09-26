use mdns_sd::{ServiceDaemon, ServiceInfo};
use base64::{engine::general_purpose::{STANDARD, STANDARD_NO_PAD}, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use rsa::{BigUint, RsaPublicKey, pkcs1v15::{Signature as RsaSignature, VerifyingKey}, signature::Verifier};
use std::{
    fs,
    io::Read,
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const SETUP_SCRIPT: &str = include_str!("../../../../scripts/setup-windows-ssh.ps1");
const INFO_SCRIPT: &str = include_str!("../resources/get-windows-info.ps1");
const SERVICE_TYPE: &str = "_pc-control._tcp.local.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PcInfo {
    host_id: String,
    display_name: String,
    hostname: String,
    current_lan_ip: String,
    lan_prefix: u8,
    ssh_port: u16,
    ssh_username: String,
    ssh_host_key_fingerprint: String,
    mac_address_candidate: Option<String>,
    default_gateway_candidate: Option<String>,
    adapter_name: Option<String>,
    accounts: Vec<String>,
    ssh_installed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    protocol_version: u8,
    host_id: String,
    display_name: String,
    pairing_endpoint: String,
    one_time_token: String,
    pairing_identity_fingerprint: String,
    expires_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingView {
    request_id: String,
    device_name: String,
    ssh_public_key_fingerprint: String,
    confirmation_code: String,
    expires_at: u64,
}

#[derive(Clone, Serialize)]
struct PairingView {
    bootstrap: Bootstrap,
    pending: Option<PendingView>,
    paired: Option<String>,
    completed: bool,
    phase: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    protocol_version: u8,
    one_time_token: String,
    device_name: String,
    ssh_public_key: String,
    request_secret: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PairingPhase {
    Pending,
    Registering,
    Verifying,
    Verified,
    Completed,
    Cancelling,
    Cancelled,
    Rejected,
    Expired,
    Failed,
}

impl PairingPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Registering => "registering",
            Self::Verifying => "verifying",
            Self::Verified => "verified",
            Self::Completed => "completed",
            Self::Cancelling => "cancelling",
            Self::Cancelled => "cancelled",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
            Self::Failed => "failed",
        }
    }
}

struct Pending {
    view: PendingView,
    public_key: String,
    request_secret_hash: Vec<u8>,
    challenge: String,
    phase: PairingPhase,
    error: Option<String>,
}

struct Session {
    bootstrap: Bootstrap,
    pc: PcInfo,
    pending: Option<Pending>,
    attempts: u8,
    token_used: bool,
    alive: Arc<AtomicBool>,
    mdns: ServiceDaemon,
    service_fullname: String,
}

#[derive(Serialize, Deserialize)]
struct CleanupRecord {
    username: String,
    public_key: String,
}

fn cleanup_record_path() -> Result<std::path::PathBuf, String> {
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("PC Control for Windows");
    fs::create_dir_all(&dir).map_err(|e| format!("정리 기록 디렉터리 오류: {e}"))?;
    Ok(dir.join("pending-pairing.json"))
}

fn write_cleanup_record(record: &CleanupRecord) -> Result<(), String> {
    let path = cleanup_record_path()?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(record).map_err(|e| e.to_string())?)
        .map_err(|e| format!("정리 기록 저장 실패: {e}"))?;
    fs::rename(temporary, path).map_err(|e| format!("정리 기록 확정 실패: {e}"))
}

fn clear_cleanup_record() -> Result<(), String> {
    let path = cleanup_record_path()?;
    if path.exists() { fs::remove_file(path).map_err(|e| format!("정리 기록 삭제 실패: {e}"))?; }
    Ok(())
}

fn remove_key(record: &CleanupRecord) -> Result<(), String> {
    run_elevated(&[
        "-Username".into(), record.username.clone(),
        "-PublicKey".into(), record.public_key.clone(), "-RemoveKey".into(),
    ])
}

fn recover_incomplete_registration() -> Result<(), String> {
    let path = cleanup_record_path()?;
    if !path.exists() { return Ok(()); }
    let bytes = fs::read(&path).map_err(|e| format!("정리 기록 읽기 실패: {e}"))?;
    let record: CleanupRecord = serde_json::from_slice(&bytes)
        .map_err(|e| format!("정리 기록 해석 실패: {e}"))?;
    remove_key(&record)?;
    clear_cleanup_record()
}

#[derive(Default)]
struct SetupState {
    session: Mutex<Option<Arc<Mutex<Session>>>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn random_hex(bytes: usize) -> String {
    let mut data = vec![0u8; bytes];
    OsRng.fill_bytes(&mut data);
    hex::encode(data)
}

fn key_fingerprint(key: &str) -> String {
    let encoded = key.split_whitespace().nth(1).unwrap_or_default();
    let blob = STANDARD.decode(encoded).unwrap_or_default();
    format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(blob)))
}

fn temporary_script_path() -> Result<std::path::PathBuf, String> {
    let path = std::env::temp_dir().join(format!("pc-control-{}.ps1", random_hex(16)));
    fs::write(&path, SETUP_SCRIPT).map_err(|e| format!("설정 스크립트 저장 실패: {e}"))?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn run_elevated(arguments: &[String]) -> Result<(), String> {
    let script = temporary_script_path()?;
    let argument_file = script.with_extension("json");
    let mut parameters = serde_json::Map::new();
    let mut index = 0;
    while index < arguments.len() {
        let name = arguments[index].strip_prefix('-').ok_or("관리자 작업 인수가 올바르지 않습니다.")?;
        if !matches!(name, "PrepareOnly" | "OpenPairingPort" | "ClosePairingPort" |
            "Username" | "PublicKey" | "RemoveKey") {
            return Err("허용되지 않은 관리자 작업입니다.".into());
        }
        if matches!(name, "PrepareOnly" | "ClosePairingPort" | "RemoveKey") {
            parameters.insert(name.into(), serde_json::Value::Bool(true));
            index += 1;
        } else {
            let value = arguments.get(index + 1).ok_or("관리자 작업 값이 없습니다.")?;
            parameters.insert(name.into(), serde_json::Value::String(value.clone()));
            index += 2;
        }
    }
    fs::write(&argument_file, serde_json::to_vec(&parameters).map_err(|e| e.to_string())?)
        .map_err(|e| format!("관리자 작업 인수 저장 실패: {e}"))?;
    let script_arg = format!("\"{}\"", script.display());
    let argument_file_arg = format!("\"{}\"", argument_file.display());
    let child_args = format!("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {script_arg} -ArgumentFile {argument_file_arg}");
    let escaped = child_args.replace('\'', "''");
    let command = format!("$ErrorActionPreference='Stop'; try {{ $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '{escaped}'; if ($null -eq $p -or $null -eq $p.ExitCode) {{ exit 1 }}; exit $p.ExitCode }} catch {{ exit 1 }}");
    let result = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status().map_err(|e| format!("Windows UAC 시작 실패: {e}"));
    let _ = fs::remove_file(&script);
    let _ = fs::remove_file(&argument_file);
    let status = result?;
    if status.success() { Ok(()) } else { Err("관리자 작업이 취소되거나 실패했습니다.".into()) }
}

#[cfg(not(target_os = "windows"))]
fn run_elevated(_arguments: &[String]) -> Result<(), String> {
    Err("Windows에서만 실행할 수 있습니다.".into())
}

#[tauri::command]
fn get_pc_connection_info() -> Result<PcInfo, String> {
    #[cfg(not(target_os = "windows"))]
    return Err("Windows에서만 PC 정보를 수집할 수 있습니다.".into());
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", INFO_SCRIPT])
            .output().map_err(|e| format!("PC 정보 수집 실패: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        serde_json::from_slice(&output.stdout).map_err(|e| format!("PC 정보 해석 실패: {e}"))
    }
}

#[tauri::command]
fn prepare_openssh() -> Result<(), String> {
    run_elevated(&["-PrepareOnly".into()])
}

fn view(session: &Session) -> PairingView {
    let phase = session.pending.as_ref().map(|p| p.phase).unwrap_or(PairingPhase::Pending);
    PairingView {
        bootstrap: session.bootstrap.clone(),
        pending: session.pending.as_ref().filter(|p| p.phase == PairingPhase::Pending).map(|p| p.view.clone()),
        paired: session.pending.as_ref().filter(|p| matches!(p.phase, PairingPhase::Verifying | PairingPhase::Verified))
            .map(|p| p.view.device_name.clone()),
        completed: phase == PairingPhase::Completed,
        phase: phase.as_str().into(),
    }
}

#[tauri::command]
fn get_pairing_state(state: State<'_, SetupState>) -> Result<PairingView, String> {
    let holder = state.session.lock().map_err(|e| e.to_string())?;
    let session = holder.as_ref().ok_or("페어링이 실행 중이지 않습니다.")?;
    let guard = session.lock().map_err(|e| e.to_string())?;
    Ok(view(&guard))
}

#[tauri::command]
fn start_pairing(ssh_username: String, state: State<'_, SetupState>) -> Result<PairingView, String> {
    let mut holder = state.session.lock().map_err(|e| e.to_string())?;
    if holder.is_some() { return Err("이미 페어링이 실행 중입니다.".into()); }
    recover_incomplete_registration()?;
    // Remove a rule left by a forced exit before opening another temporary port.
    run_elevated(&["-ClosePairingPort".into()])?;
    let mut pc = get_pc_connection_info()?;
    if !pc.ssh_installed || pc.ssh_host_key_fingerprint.is_empty() {
        return Err("먼저 OpenSSH를 준비해주세요.".into());
    }
    if !pc.accounts.iter().any(|name| name == &ssh_username) {
        return Err("선택한 Windows 계정을 찾을 수 없습니다.".into());
    }
    pc.ssh_username = ssh_username;
    let server = Server::http(format!("{}:0", pc.current_lan_ip))
        .map_err(|e| format!("페어링 포트를 열 수 없습니다: {e}"))?;
    let port = server.server_addr().to_ip().ok_or("페어링 포트를 확인할 수 없습니다.")?.port();
    let bootstrap = Bootstrap {
        protocol_version: 1,
        host_id: pc.host_id.clone(),
        display_name: pc.display_name.clone(),
        pairing_endpoint: format!("http://{}:{port}", pc.current_lan_ip),
        one_time_token: random_hex(24),
        pairing_identity_fingerprint: pc.ssh_host_key_fingerprint.clone(),
        expires_at: now_ms() + 5 * 60 * 1000,
    };
    let mdns = ServiceDaemon::new().map_err(|e| format!("mDNS 시작 실패: {e}"))?;
    let service = ServiceInfo::new(
        SERVICE_TYPE, &pc.display_name, &format!("{}.local.", pc.hostname),
        pc.current_lan_ip.as_str(), port,
        &[ ("id", pc.host_id.as_str()), ("v", "1") ][..],
    ).map_err(|e| format!("mDNS 서비스 오류: {e}"))?;
    let service_fullname = service.get_fullname().to_owned();
    if let Err(error) = run_elevated(&["-OpenPairingPort".into(), port.to_string()]) {
        let _ = mdns.shutdown();
        return Err(error);
    }
    if let Err(error) = mdns.register(service) {
        let _ = mdns.shutdown();
        let _ = run_elevated(&["-ClosePairingPort".into()]);
        return Err(format!("mDNS 알림 실패: {error}"));
    }
    let alive = Arc::new(AtomicBool::new(true));
    let session = Arc::new(Mutex::new(Session {
        bootstrap, pc, pending: None, attempts: 0, token_used: false,
        alive: alive.clone(), mdns,
        service_fullname,
    }));
    let server_session = session.clone();
    std::thread::spawn(move || serve_pairing(server, server_session, alive));
    let expiry_session = session.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let should_end = match expiry_session.lock() {
                Ok(guard) => {
                    if !guard.alive.load(Ordering::SeqCst) { return; }
                    let deadline = guard.pending.as_ref()
                        .filter(|p| matches!(p.phase, PairingPhase::Registering | PairingPhase::Verifying | PairingPhase::Verified))
                        .map(|p| p.view.expires_at)
                        .unwrap_or(guard.bootstrap.expires_at);
                    now_ms() >= deadline
                }
                Err(_) => return,
            };
            if should_end { break; }
        }
        let _ = end_session(&expiry_session, true);
    });
    let initial = view(&session.lock().map_err(|e| e.to_string())?);
    *holder = Some(session);
    Ok(initial)
}

#[tauri::command]
fn decide_pairing(request_id: String, approved: bool, state: State<'_, SetupState>) -> Result<(), String> {
    let session = {
        let holder = state.session.lock().map_err(|e| e.to_string())?;
        holder.as_ref().cloned().ok_or("페어링이 실행 중이지 않습니다.")?
    };
    let record = {
        let mut guard = session.lock().map_err(|e| e.to_string())?;
        if guard.bootstrap.expires_at < now_ms() { return Err("페어링 시간이 만료되었습니다.".into()); }
        let username = guard.pc.ssh_username.clone();
        let pending = guard.pending.as_mut().ok_or("승인할 연결 요청이 없습니다.")?;
        if pending.view.request_id != request_id || pending.view.expires_at < now_ms() ||
            pending.phase != PairingPhase::Pending {
            return Err("연결 요청이 만료되었거나 변경되었습니다.".into());
        }
        if !approved {
            pending.phase = PairingPhase::Rejected;
            return Ok(());
        }
        let record = CleanupRecord { username, public_key: pending.public_key.clone() };
        // A record is durable before the elevated process can change authorized_keys.
        write_cleanup_record(&record)?;
        pending.phase = PairingPhase::Registering;
        pending.view.expires_at = now_ms() + 10 * 60 * 1000;
        record
    };
    std::thread::spawn(move || {
        let registered = run_elevated(&[
            "-Username".into(), record.username.clone(),
            "-PublicKey".into(), record.public_key.clone(),
        ]);
        let cancelled = {
            let mut guard = match session.lock() { Ok(value) => value, Err(_) => return };
            let alive = guard.alive.load(Ordering::SeqCst);
            let Some(pending) = guard.pending.as_mut() else { return };
            let cancelled = pending.phase == PairingPhase::Cancelling || !alive;
            if registered.is_ok() && !cancelled {
                pending.phase = PairingPhase::Verifying;
                pending.view.expires_at = now_ms() + 30 * 60 * 1000;
            } else if registered.is_err() {
                pending.phase = PairingPhase::Failed;
                pending.error = registered.as_ref().err().cloned();
            }
            cancelled
        };
        if registered.is_err() || cancelled {
            let removed = remove_key(&record);
            if removed.is_ok() { let _ = clear_cleanup_record(); }
            if let Ok(mut guard) = session.lock() {
                if let Some(pending) = guard.pending.as_mut() {
                    if removed.is_ok() && cancelled { pending.phase = PairingPhase::Cancelled; }
                    if let Err(error) = removed {
                        pending.phase = PairingPhase::Failed;
                        pending.error = Some(format!("등록 취소 실패: {error}"));
                    }
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn revoke_pairing(state: State<'_, SetupState>) -> Result<(), String> {
    let session = {
        let holder = state.session.lock().map_err(|e| e.to_string())?;
        holder.as_ref().cloned().ok_or("페어링이 실행 중이지 않습니다.")?
    };
    cancel_registration(&session)
}

#[tauri::command]
fn stop_pairing(state: State<'_, SetupState>) -> Result<(), String> {
    stop_session(&state)
}

fn stop_session(state: &SetupState) -> Result<(), String> {
    let session = state.session.lock().map_err(|e| e.to_string())?.take();
    if let Some(session) = session { end_session(&session, false) } else { Ok(()) }
}

fn cancel_registration(session: &Arc<Mutex<Session>>) -> Result<(), String> {
    let record = {
        let mut guard = session.lock().map_err(|e| e.to_string())?;
        let username = guard.pc.ssh_username.clone();
        let pending = guard.pending.as_mut().ok_or("취소할 요청이 없습니다.")?;
        match pending.phase {
            PairingPhase::Pending => { pending.phase = PairingPhase::Cancelled; return Ok(()); }
            PairingPhase::Registering => { pending.phase = PairingPhase::Cancelling; return Ok(()); }
            PairingPhase::Verifying | PairingPhase::Verified | PairingPhase::Failed | PairingPhase::Completed => {
                pending.phase = PairingPhase::Cancelling;
                CleanupRecord { username, public_key: pending.public_key.clone() }
            }
            PairingPhase::Cancelling => return Ok(()),
            _ => return Ok(()),
        }
    };
    if !cleanup_record_path()?.exists() { write_cleanup_record(&record)?; }
    let result = remove_key(&record);
    let mut guard = session.lock().map_err(|e| e.to_string())?;
    if let Some(pending) = guard.pending.as_mut() {
        match &result {
            Ok(()) => { pending.phase = PairingPhase::Cancelled; let _ = clear_cleanup_record(); }
            Err(error) => { pending.phase = PairingPhase::Failed; pending.error = Some(format!("등록 취소 실패: {error}")); }
        }
    }
    result
}

fn end_session(session: &Arc<Mutex<Session>>, expired: bool) -> Result<(), String> {
    let was_alive = {
        let guard = session.lock().map_err(|e| e.to_string())?;
        let was_alive = guard.alive.swap(false, Ordering::SeqCst);
        if was_alive {
            let _ = guard.mdns.unregister(&guard.service_fullname);
            let _ = guard.mdns.shutdown();
        }
        was_alive
    };
    let rollback = {
        let guard = session.lock().map_err(|e| e.to_string())?;
        guard.pending.as_ref().is_some_and(|p|
            !matches!(p.phase, PairingPhase::Completed | PairingPhase::Rejected | PairingPhase::Cancelled))
    };
    let key_result = if rollback { cancel_registration(session) } else { Ok(()) };
    let firewall_result = if was_alive { run_elevated(&["-ClosePairingPort".into()]) } else { Ok(()) };
    if expired {
        if let Ok(mut guard) = session.lock() {
            if let Some(pending) = guard.pending.as_mut() {
                if pending.phase == PairingPhase::Cancelled { pending.phase = PairingPhase::Expired; }
            }
        }
    }
    key_result.and(firewall_result)
}

fn reply(request: tiny_http::Request, status: u16, value: serde_json::Value) {
    let body = value.to_string();
    let response = Response::from_string(body).with_status_code(StatusCode(status)).with_header(
        Header::from_bytes("Content-Type", "application/json; charset=utf-8").expect("fixed header"),
    );
    let _ = request.respond(response);
}

fn request_is_authorized(request: &tiny_http::Request, pending: &Pending) -> bool {
    let Some(secret) = request.headers().iter()
        .find(|header| header.field.equiv("X-PC-Control-Request-Secret"))
        .map(|header| header.value.as_str()) else { return false };
    let digest = Sha256::digest(secret.as_bytes());
    digest.len() == pending.request_secret_hash.len() &&
        digest.iter().zip(&pending.request_secret_hash).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
}

fn ssh_string<'a>(bytes: &'a [u8], offset: &mut usize) -> Option<&'a [u8]> {
    let length = u32::from_be_bytes(bytes.get(*offset..*offset + 4)?.try_into().ok()?) as usize;
    *offset += 4;
    let value = bytes.get(*offset..*offset + length)?;
    *offset += length;
    Some(value)
}

fn verify_phone_signature(pending: &Pending, encoded_signature: &str) -> bool {
    let mut offset = 0;
    let Some(encoded_key) = pending.public_key.split_whitespace().nth(1) else { return false };
    let Ok(blob) = STANDARD.decode(encoded_key) else { return false };
    if ssh_string(&blob, &mut offset) != Some(&b"ssh-rsa"[..]) { return false; }
    let Some(exponent) = ssh_string(&blob, &mut offset) else { return false };
    let Some(modulus) = ssh_string(&blob, &mut offset) else { return false };
    if offset != blob.len() { return false; }
    let Ok(key) = RsaPublicKey::new(BigUint::from_bytes_be(modulus), BigUint::from_bytes_be(exponent)) else { return false };
    let Ok(raw) = STANDARD.decode(encoded_signature) else { return false };
    let Ok(signature) = RsaSignature::try_from(raw.as_slice()) else { return false };
    let message = format!("pc-control-pairing-v1:{}:{}", pending.view.request_id, pending.challenge);
    VerifyingKey::<Sha256>::new(key).verify(message.as_bytes(), &signature).is_ok()
}

fn serve_pairing(server: Server, session: Arc<Mutex<Session>>, alive: Arc<AtomicBool>) {
    while alive.load(Ordering::SeqCst) {
        let Ok(Some(mut request)) = server.recv_timeout(Duration::from_millis(500)) else { continue };
        let path = request.url().to_owned();
        let method = request.method().clone();
        let mut guard = match session.lock() {
            Ok(value) => value,
            Err(_) => { reply(request, 500, serde_json::json!({"error":"internal"})); continue; }
        };
        if method == Method::Post && path.starts_with("/v1/requests/") && path.ends_with("/complete") {
            let requested = path.trim_start_matches("/v1/requests/").trim_end_matches("/complete");
            let authorized = guard.pending.as_ref().is_some_and(|p|
                p.view.request_id == requested && request_is_authorized(&request, p));
            if !authorized { reply(request, 403, serde_json::json!({"error":"unauthorized"})); continue; }
            let mut body = String::new();
            if request.as_reader().take(4096).read_to_string(&mut body).is_err() {
                reply(request, 400, serde_json::json!({"error":"invalid request"})); continue;
            }
            let signature = serde_json::from_str::<serde_json::Value>(&body).ok()
                .and_then(|value| value.get("signature").and_then(|s| s.as_str()).map(str::to_owned));
            let pending = guard.pending.as_mut().expect("authorized pending");
            if !matches!(pending.phase, PairingPhase::Verifying | PairingPhase::Verified) ||
                pending.view.expires_at < now_ms() ||
                !signature.as_deref().is_some_and(|s| verify_phone_signature(pending, s)) {
                reply(request, 403, serde_json::json!({"error":"verification required"})); continue;
            }
            pending.phase = PairingPhase::Verified;
            reply(request, 200, serde_json::json!({"verified":true}));
            continue;
        }
        if method == Method::Post && path.starts_with("/v1/requests/") && path.ends_with("/finalize") {
            let requested = path.trim_start_matches("/v1/requests/").trim_end_matches("/finalize");
            let authorized = guard.pending.as_ref().is_some_and(|p|
                p.view.request_id == requested && request_is_authorized(&request, p));
            if !authorized { reply(request, 403, serde_json::json!({"error":"unauthorized"})); continue; }
            let pending = guard.pending.as_mut().expect("authorized pending");
            if pending.phase != PairingPhase::Verified || pending.view.expires_at < now_ms() {
                reply(request, 403, serde_json::json!({"error":"verification required"})); continue;
            }
            if let Err(error) = clear_cleanup_record() {
                reply(request, 500, serde_json::json!({"error":error})); continue;
            }
            pending.phase = PairingPhase::Completed;
            reply(request, 200, serde_json::json!({"completed":true}));
            continue;
        }
        if method == Method::Post && path.starts_with("/v1/requests/") && path.ends_with("/cancel") {
            let requested = path.trim_start_matches("/v1/requests/").trim_end_matches("/cancel");
            let authorized = guard.pending.as_ref().is_some_and(|p|
                p.view.request_id == requested && request_is_authorized(&request, p));
            if !authorized { reply(request, 403, serde_json::json!({"error":"unauthorized"})); continue; }
            drop(guard);
            let cancel_session = session.clone();
            std::thread::spawn(move || { let _ = cancel_registration(&cancel_session); });
            reply(request, 202, serde_json::json!({"cancelled":true}));
            continue;
        }
        if method == Method::Get && path == "/v1/bootstrap" {
            if guard.bootstrap.expires_at < now_ms() {
                reply(request, 410, serde_json::json!({"error":"expired"})); continue;
            }
            reply(request, 200, serde_json::to_value(&guard.bootstrap).unwrap_or_default());
            continue;
        }
        if method == Method::Post && path == "/v1/requests" {
            if guard.bootstrap.expires_at < now_ms() {
                reply(request, 410, serde_json::json!({"error":"expired"})); continue;
            }
            if guard.attempts >= 5 {
                reply(request, 429, serde_json::json!({"error":"attempt limit"}));
                continue;
            }
            guard.attempts += 1;
            if guard.token_used || guard.pending.is_some() {
                reply(request, 409, serde_json::json!({"error":"busy"}));
                continue;
            }
            let mut body = String::new();
            if request.as_reader().take(4096).read_to_string(&mut body).is_err() {
                reply(request, 400, serde_json::json!({"error":"invalid request"}));
                continue;
            }
            let Ok(payload) = serde_json::from_str::<PairRequest>(&body) else {
                reply(request, 400, serde_json::json!({"error":"invalid json"}));
                continue;
            };
            if payload.protocol_version != 1 || payload.one_time_token != guard.bootstrap.one_time_token ||
                payload.device_name.len() > 80 || payload.device_name.is_empty() ||
                payload.request_secret.len() != 64 || !payload.request_secret.bytes().all(|b| b.is_ascii_hexdigit()) ||
                !valid_public_key(&payload.ssh_public_key) {
                reply(request, 403, serde_json::json!({"error":"invalid pairing request"}));
                continue;
            }
            let request_id = random_hex(16);
            guard.token_used = true;
            // Give this session its own authorized_keys line, even if the same key already exists.
            // Rollback must never remove a key that predates this pairing attempt.
            let registration_key = format!("{} pc-control-{}",
                payload.ssh_public_key.split_whitespace().take(2).collect::<Vec<_>>().join(" "),
                request_id);
            let mut hasher = Sha256::new();
            hasher.update(guard.bootstrap.one_time_token.as_bytes());
            hasher.update(payload.ssh_public_key.as_bytes());
            hasher.update(guard.pc.ssh_host_key_fingerprint.as_bytes());
            let digest = hasher.finalize();
            let number = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
            let confirmation_code = format!("{number:06}");
            let pending = PendingView {
                request_id: request_id.clone(), device_name: payload.device_name,
                ssh_public_key_fingerprint: key_fingerprint(&registration_key),
                confirmation_code: confirmation_code.clone(), expires_at: now_ms() + 2 * 60 * 1000,
            };
            guard.pending = Some(Pending {
                view: pending.clone(), public_key: registration_key,
                request_secret_hash: Sha256::digest(payload.request_secret.as_bytes()).to_vec(),
                challenge: random_hex(32), phase: PairingPhase::Pending, error: None,
            });
            reply(request, 200, serde_json::json!({"requestId":request_id,"confirmationCode":confirmation_code,"expiresAt":pending.expires_at}));
            continue;
        }
        if method == Method::Get && path.starts_with("/v1/requests/") {
            let requested = path.trim_start_matches("/v1/requests/");
            if let Some(pending) = &guard.pending {
                if pending.view.request_id == requested {
                    if !request_is_authorized(&request, pending) {
                        reply(request, 403, serde_json::json!({"error":"unauthorized"})); continue;
                    }
                    let value = match pending.phase {
                        PairingPhase::Pending if pending.view.expires_at < now_ms() =>
                            serde_json::json!({"state":"expired","requestId":requested}),
                        PairingPhase::Pending =>
                            serde_json::json!({"state":"pending","requestId":requested,"confirmationCode":pending.view.confirmation_code}),
                        PairingPhase::Verifying =>
                            serde_json::json!({"state":"verifying","requestId":requested,"pc":&guard.pc,"challenge":pending.challenge}),
                        other => serde_json::json!({"state":other.as_str(),"requestId":requested,"error":pending.error}),
                    };
                    reply(request, 200, value);
                    continue;
                }
            }
        }
        reply(request, 404, serde_json::json!({"error":"not found"}));
    }
}

fn valid_public_key(value: &str) -> bool {
    let parts: Vec<&str> = value.split_whitespace().collect();
    (parts.len() == 2 || parts.len() == 3) && value.len() < 2048 &&
        parts[0] == "ssh-rsa" &&
        parts[1].chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')) &&
        STANDARD.decode(parts[1]).is_ok()
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(SetupState::default())
        .invoke_handler(tauri::generate_handler![
            get_pc_connection_info, prepare_openssh, start_pairing,
            get_pairing_state, decide_pairing, revoke_pairing, stop_pairing,
        ])
        .build(tauri::generate_context!())
        .expect("PC Control for Windows failed to build");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<SetupState>();
            let _ = stop_session(&state);
        }
    });
}
