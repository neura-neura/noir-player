use std::{
    collections::{BTreeSet, HashMap},
    ffi::OsStr,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::SystemTime,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
#[cfg(target_os = "windows")]
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    RegKey,
};

const SUPPORTED_VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "m4v", "webm", "ts", "m2ts", "wmv", "flv",
];
const SUPPORTED_EXTERNAL_SUBTITLE_EXTENSIONS: &[&str] = &[
    "srt", "vtt", "ass", "ssa", "sup", "pgs", "idx", "sub", "zip",
];
const PLAYBACK_CACHE_VERSION: &str = "browser-h264-aac-v1";
const HLS_CACHE_VERSION: &str = "ts-hls-segments-v1";
const HLS_SEGMENT_SECONDS: f64 = 2.0;
const SYNCPLAY_CONTROL_ADDR: &str = "127.0.0.1:32123";

#[derive(Default)]
struct LaunchVideoState {
    pending_video: Mutex<Option<String>>,
}

#[derive(Default)]
struct TsStreamServerState {
    server: Mutex<Option<TsStreamServerHandle>>,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncplayStatus {
    loaded: bool,
    paused: bool,
    position: f64,
    duration: f64,
    rate: f64,
    path: Option<String>,
    file_name: Option<String>,
}

#[derive(Clone, Default)]
struct SyncplayControlState {
    status: Arc<Mutex<SyncplayStatus>>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncplayCommand {
    command: String,
    position: Option<f64>,
    rate: Option<f64>,
    path: Option<String>,
    message: Option<String>,
    muted: Option<bool>,
}

#[derive(Clone)]
struct TsStreamServerHandle {
    port: u16,
    sessions: Arc<Mutex<HashMap<String, TsStreamSession>>>,
}

#[derive(Clone)]
struct TsStreamSession {
    path: String,
    duration_seconds: f64,
    segment_seconds: f64,
    segment_count: usize,
    cache_dir: PathBuf,
    ffmpeg_path: PathBuf,
    copy_video: bool,
    copy_audio: bool,
}

#[derive(Clone, serde::Serialize)]
struct OpenFilePayload {
    path: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistVideo {
    path: String,
    file_name: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TsStreamSource {
    playlist_url: String,
    duration_seconds: f64,
}

#[derive(Clone, serde::Serialize)]
struct EmbeddedSubtitleStream {
    index: usize,
    label: String,
    detail: String,
}

#[derive(Clone, serde::Serialize)]
struct EmbeddedAudioStream {
    index: usize,
    order: usize,
    label: String,
    detail: String,
    codec: String,
}

#[derive(serde::Deserialize)]
struct FfprobeResponse {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
}

#[derive(serde::Deserialize)]
struct FfprobeStream {
    index: usize,
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    pix_fmt: Option<String>,
    #[serde(default)]
    tags: Option<FfprobeStreamTags>,
}

#[derive(serde::Deserialize)]
struct FfprobeStreamTags {
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

fn is_supported_video_path(path: &str) -> bool {
    let path = Path::new(path);
    if !path.exists() || !path.is_file() {
        return false;
    }

    path.extension()
        .map(is_supported_video_extension)
        .unwrap_or(false)
}

fn is_supported_video_extension(extension: &OsStr) -> bool {
    extension
        .to_str()
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            SUPPORTED_VIDEO_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or(false)
}

fn is_supported_external_subtitle_extension(extension: &OsStr) -> bool {
    extension
        .to_str()
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            SUPPORTED_EXTERNAL_SUBTITLE_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or(false)
}

fn external_subtitle_extension_priority(extension: &OsStr) -> usize {
    let normalized = extension
        .to_str()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    SUPPORTED_EXTERNAL_SUBTITLE_EXTENSIONS
        .iter()
        .position(|candidate| *candidate == normalized)
        .unwrap_or(usize::MAX)
}

fn find_matching_external_subtitle_path(video_path: &Path) -> Result<Option<PathBuf>, String> {
    if !video_path.exists() || !video_path.is_file() {
        return Ok(None);
    }

    let Some(video_stem) = video_path.file_stem().and_then(OsStr::to_str) else {
        return Ok(None);
    };
    let Some(parent_path) = video_path.parent() else {
        return Ok(None);
    };
    let normalized_video_stem = video_stem.to_lowercase();
    let mut candidates = Vec::new();

    for entry in fs::read_dir(parent_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let candidate_path = entry.path();
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }

        let Some(extension) = candidate_path.extension() else {
            continue;
        };
        if !is_supported_external_subtitle_extension(extension) {
            continue;
        }

        let Some(candidate_stem) = candidate_path.file_stem().and_then(OsStr::to_str) else {
            continue;
        };
        if candidate_stem.to_lowercase() != normalized_video_stem {
            continue;
        }

        let file_name = candidate_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        candidates.push((
            external_subtitle_extension_priority(extension),
            file_name.to_lowercase(),
            file_name,
            candidate_path,
        ));
    }

    candidates.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });

    Ok(candidates.into_iter().next().map(|(_, _, _, path)| path))
}

fn is_transport_stream_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "ts" | "m2ts"))
        .unwrap_or(false)
}

fn video_stream_requires_browser_fallback(stream: &FfprobeStream) -> bool {
    let codec_name = stream
        .codec_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let pixel_format = stream
        .pix_fmt
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let browser_unreliable_codec = matches!(
        codec_name.as_str(),
        "hevc"
            | "h265"
            | "av1"
            | "av01"
            | "mpeg1video"
            | "mpeg2video"
            | "vc1"
            | "wmv3"
            | "prores"
            | "dnxhd"
            | "dnxhr"
            | "ffv1"
            | "huffyuv"
            | "rawvideo"
            | "jpeg2000"
    );
    let high_bit_depth = ["10", "12", "14", "16"]
        .iter()
        .any(|marker| pixel_format.contains(marker));
    let unsupported_chroma = pixel_format.contains("422") || pixel_format.contains("444");

    browser_unreliable_codec || high_bit_depth || unsupported_chroma
}

fn find_first_video_arg<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .find(|argument| !argument.starts_with('-') && is_supported_video_path(argument))
}

#[cfg(target_os = "windows")]
fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(target_os = "windows"))]
fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    Command::new(program)
}

fn bundled_binary_path(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidates = [
        resource_dir.join("resources").join("bin").join(file_name),
        resource_dir.join("bin").join(file_name),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn dev_binary_path(file_name: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join(file_name);

    candidate.exists().then_some(candidate)
}

fn resolve_binary_path(app: &AppHandle, file_name: &str) -> PathBuf {
    bundled_binary_path(app, file_name)
        .or_else(|| dev_binary_path(file_name))
        .unwrap_or_else(|| PathBuf::from(file_name))
}

fn cache_key(input: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}

fn playback_cache_key(path: &str) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    PLAYBACK_CACHE_VERSION.hash(&mut hasher);
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);

    if let Ok(modified_time) = metadata.modified() {
        if let Ok(duration) = modified_time.duration_since(SystemTime::UNIX_EPOCH) {
            duration.as_secs().hash(&mut hasher);
            duration.subsec_nanos().hash(&mut hasher);
        }
    }

    Ok(hasher.finish())
}

fn cache_file_is_usable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

fn hls_cache_key(path: &str) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    HLS_CACHE_VERSION.hash(&mut hasher);
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);

    if let Ok(modified_time) = metadata.modified() {
        if let Ok(duration) = modified_time.duration_since(SystemTime::UNIX_EPOCH) {
            duration.as_secs().hash(&mut hasher);
            duration.subsec_nanos().hash(&mut hasher);
        }
    }

    Ok(hasher.finish())
}

fn parse_server_port(server_addr: &str) -> Result<u16, String> {
    server_addr
        .rsplit(':')
        .next()
        .and_then(|port| port.parse::<u16>().ok())
        .ok_or_else(|| format!("Invalid local HLS server address: {server_addr}"))
}

fn make_header(name: &str, value: &str) -> Option<tiny_http::Header> {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).ok()
}

fn add_common_headers<R>(response: tiny_http::Response<R>) -> tiny_http::Response<R>
where
    R: std::io::Read,
{
    let mut response = response;
    for (name, value) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Range, Content-Type"),
    ] {
        if let Some(header) = make_header(name, value) {
            response.add_header(header);
        }
    }
    response
}

fn respond_text(request: tiny_http::Request, status: u16, body: String, content_type: &str) {
    let mut response = add_common_headers(
        tiny_http::Response::from_string(body).with_status_code(tiny_http::StatusCode(status)),
    );
    if let Some(header) = make_header("Content-Type", content_type) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn respond_json<T: serde::Serialize>(request: tiny_http::Request, status: u16, body: &T) {
    match serde_json::to_string(body) {
        Ok(body) => respond_text(request, status, body, "application/json; charset=utf-8"),
        Err(error) => respond_text(
            request,
            500,
            format!("Could not encode response: {error}"),
            "text/plain; charset=utf-8",
        ),
    }
}

fn respond_bytes(request: tiny_http::Request, status: u16, body: Vec<u8>, content_type: &str) {
    let mut response = add_common_headers(
        tiny_http::Response::from_data(body).with_status_code(tiny_http::StatusCode(status)),
    );
    if let Some(header) = make_header("Content-Type", content_type) {
        response.add_header(header);
    }
    if let Some(header) = make_header("Cache-Control", "public, max-age=3600") {
        response.add_header(header);
    }
    let _ = request.respond(response);
}

fn handle_syncplay_request(
    mut request: tiny_http::Request,
    app: &AppHandle,
    status: &Arc<Mutex<SyncplayStatus>>,
) {
    if request.method() == &tiny_http::Method::Options {
        let response = add_common_headers(
            tiny_http::Response::empty(tiny_http::StatusCode(204))
                .with_status_code(tiny_http::StatusCode(204)),
        );
        let _ = request.respond(response);
        return;
    }

    let url = request.url().split('?').next().unwrap_or(request.url());
    match (request.method(), url) {
        (&tiny_http::Method::Get, "/syncplay/health") => {
            respond_json(
                request,
                200,
                &serde_json::json!({"ok": true, "protocol": 1}),
            );
        }
        (&tiny_http::Method::Get, "/syncplay/status") => {
            let snapshot = status
                .lock()
                .map(|current| current.clone())
                .unwrap_or_default();
            respond_json(request, 200, &snapshot);
        }
        (&tiny_http::Method::Post, "/syncplay/command") => {
            let mut body = String::new();
            if let Err(error) = request.as_reader().read_to_string(&mut body) {
                respond_text(
                    request,
                    400,
                    format!("Could not read command: {error}"),
                    "text/plain; charset=utf-8",
                );
                return;
            }

            match serde_json::from_str::<SyncplayCommand>(&body) {
                Ok(command) => {
                    let _ = app.emit("syncplay-command", command);
                    respond_json(request, 200, &serde_json::json!({"ok": true}));
                }
                Err(error) => respond_text(
                    request,
                    400,
                    format!("Invalid command: {error}"),
                    "text/plain; charset=utf-8",
                ),
            }
        }
        _ => respond_text(
            request,
            404,
            "Not found".into(),
            "text/plain; charset=utf-8",
        ),
    }
}

fn start_syncplay_control_server(
    app: AppHandle,
    status: Arc<Mutex<SyncplayStatus>>,
) -> Result<(), String> {
    let server =
        tiny_http::Server::http(SYNCPLAY_CONTROL_ADDR).map_err(|error| error.to_string())?;

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_syncplay_request(request, &app, &status);
        }
    });

    Ok(())
}

fn build_hls_playlist(session: &TsStreamSession) -> String {
    let target_duration = session.segment_seconds.ceil() as u32;
    let mut playlist = format!(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:{target_duration}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-INDEPENDENT-SEGMENTS\n"
    );

    for index in 0..session.segment_count {
        let start_seconds = index as f64 * session.segment_seconds;
        let remaining_seconds = (session.duration_seconds - start_seconds).max(0.0);
        let segment_seconds = remaining_seconds.min(session.segment_seconds);
        playlist.push_str("#EXT-X-DISCONTINUITY\n");
        playlist.push_str(&format!("#EXTINF:{segment_seconds:.3},\n"));
        playlist.push_str(&format!("segment/{index}.ts\n"));
    }

    playlist.push_str("#EXT-X-ENDLIST\n");
    playlist
}

fn segment_file_name(index: usize) -> String {
    format!("{index:06}.ts")
}

fn generate_hls_segment(session: &TsStreamSession, index: usize) -> Result<Vec<u8>, String> {
    if index >= session.segment_count {
        return Err("Requested TS segment is outside the video duration.".into());
    }

    fs::create_dir_all(&session.cache_dir).map_err(|error| error.to_string())?;
    let cache_file = session.cache_dir.join(segment_file_name(index));
    if cache_file_is_usable(&cache_file) {
        return fs::read(&cache_file).map_err(|error| error.to_string());
    }
    if cache_file.exists() {
        let _ = fs::remove_file(&cache_file);
    }

    let partial_file = session
        .cache_dir
        .join(format!("{}.partial", segment_file_name(index)));
    if partial_file.exists() {
        let _ = fs::remove_file(&partial_file);
    }

    let start_seconds = index as f64 * session.segment_seconds;
    let remaining_seconds = (session.duration_seconds - start_seconds).max(0.0);
    let segment_seconds = remaining_seconds.min(session.segment_seconds);
    let start_arg = format!("{start_seconds:.3}");
    let duration_arg = format!("{segment_seconds:.3}");
    let output_arg = partial_file
        .to_str()
        .ok_or_else(|| "Invalid HLS segment cache path.".to_string())?
        .to_string();

    let mut args = vec![
        "-v".to_string(),
        "error".to_string(),
        "-nostdin".to_string(),
        "-ss".to_string(),
        start_arg,
        "-i".to_string(),
        session.path.clone(),
        "-t".to_string(),
        duration_arg,
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a:0?".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
    ];

    if session.copy_video {
        args.extend(["-c:v".to_string(), "copy".to_string()]);
    } else {
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "ultrafast".to_string(),
            "-tune".to_string(),
            "zerolatency".to_string(),
            "-crf".to_string(),
            "23".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-g".to_string(),
            "60".to_string(),
            "-keyint_min".to_string(),
            "60".to_string(),
            "-sc_threshold".to_string(),
            "0".to_string(),
        ]);
    }

    if session.copy_audio {
        args.extend(["-c:a".to_string(), "copy".to_string()]);
    } else {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "160k".to_string(),
            "-ac".to_string(),
            "2".to_string(),
        ]);
    }

    args.extend([
        "-muxdelay".to_string(),
        "0".to_string(),
        "-f".to_string(),
        "mpegts".to_string(),
        "-mpegts_flags".to_string(),
        "+initial_discontinuity".to_string(),
        "-y".to_string(),
        output_arg,
    ]);

    let output = hidden_command(&session.ffmpeg_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let _ = fs::remove_file(&partial_file);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffmpeg could not generate that TS stream segment.".into()
        } else {
            stderr
        });
    }

    if !cache_file_is_usable(&partial_file) {
        let _ = fs::remove_file(&partial_file);
        return Err("ffmpeg generated an empty TS stream segment.".into());
    }

    fs::rename(&partial_file, &cache_file)
        .or_else(|_| {
            fs::copy(&partial_file, &cache_file)?;
            fs::remove_file(&partial_file)?;
            Ok::<(), std::io::Error>(())
        })
        .map_err(|error| error.to_string())?;

    fs::read(&cache_file).map_err(|error| error.to_string())
}

fn handle_hls_request(
    request: tiny_http::Request,
    sessions: &Arc<Mutex<HashMap<String, TsStreamSession>>>,
) {
    if request.method() == &tiny_http::Method::Options {
        let response = add_common_headers(
            tiny_http::Response::empty(tiny_http::StatusCode(204))
                .with_status_code(tiny_http::StatusCode(204)),
        );
        let _ = request.respond(response);
        return;
    }

    let url = request.url().split('?').next().unwrap_or(request.url());
    let parts = url.trim_start_matches('/').split('/').collect::<Vec<_>>();

    if parts.len() < 3 || parts.first() != Some(&"hls") {
        respond_text(
            request,
            404,
            "Not found".into(),
            "text/plain; charset=utf-8",
        );
        return;
    }

    let session_id = parts[1];
    let session = match sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
    {
        Some(session) => session,
        None => {
            respond_text(
                request,
                404,
                "HLS session not found".into(),
                "text/plain; charset=utf-8",
            );
            return;
        }
    };

    if parts[2] == "playlist.m3u8" {
        respond_text(
            request,
            200,
            build_hls_playlist(&session),
            "application/vnd.apple.mpegurl; charset=utf-8",
        );
        return;
    }

    if parts.len() == 4 && parts[2] == "segment" {
        let Some(raw_index) = parts[3].strip_suffix(".ts") else {
            respond_text(
                request,
                404,
                "Not found".into(),
                "text/plain; charset=utf-8",
            );
            return;
        };
        let Ok(index) = raw_index.parse::<usize>() else {
            respond_text(
                request,
                400,
                "Invalid segment index".into(),
                "text/plain; charset=utf-8",
            );
            return;
        };

        match generate_hls_segment(&session, index) {
            Ok(segment) => respond_bytes(request, 200, segment, "video/mp2t"),
            Err(error) => respond_text(request, 500, error, "text/plain; charset=utf-8"),
        }
        return;
    }

    respond_text(
        request,
        404,
        "Not found".into(),
        "text/plain; charset=utf-8",
    );
}

fn ensure_ts_stream_server(
    state: &State<'_, TsStreamServerState>,
) -> Result<TsStreamServerHandle, String> {
    let mut server_guard = state.server.lock().map_err(|error| error.to_string())?;
    if let Some(server) = server_guard.as_ref() {
        return Ok(server.clone());
    }

    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = parse_server_port(&server.server_addr().to_string())?;
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let server_sessions = Arc::clone(&sessions);

    thread::spawn(move || {
        for request in server.incoming_requests() {
            handle_hls_request(request, &server_sessions);
        }
    });

    let handle = TsStreamServerHandle { port, sessions };
    *server_guard = Some(handle.clone());
    Ok(handle)
}

fn format_stream_label(
    title: &str,
    language: &str,
    fallback_prefix: &str,
    position: usize,
) -> String {
    if !title.is_empty() {
        title.to_string()
    } else if !language.is_empty() {
        language.to_uppercase()
    } else {
        format!("{fallback_prefix} {}", position + 1)
    }
}

fn format_stream_detail(language: &str, codec: &str) -> String {
    let mut detail_parts = Vec::new();
    if !language.is_empty() {
        detail_parts.push(language.to_uppercase());
    }
    if !codec.is_empty() {
        detail_parts.push(codec.to_uppercase());
    }

    detail_parts.join(" | ")
}

fn is_known_subtitle_codec(codec_name: &str) -> bool {
    matches!(
        codec_name.trim().to_ascii_lowercase().as_str(),
        "subrip"
            | "srt"
            | "webvtt"
            | "mov_text"
            | "ass"
            | "ssa"
            | "ttml"
            | "hdmv_pgs_subtitle"
            | "dvd_subtitle"
            | "dvb_subtitle"
    )
}

fn probe_streams(app: &AppHandle, path: &str) -> Result<Vec<FfprobeStream>, String> {
    let ffprobe_path = resolve_binary_path(app, "ffprobe.exe");
    let output = hidden_command(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=index,codec_type,codec_name,pix_fmt:stream_tags=language,title",
            "-of",
            "json",
            path,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe could not inspect the file streams.".into()
        } else {
            stderr
        });
    }

    let parsed: FfprobeResponse =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    Ok(parsed.streams)
}

fn fallback_subtitle_streams(app: &AppHandle, path: &str) -> Vec<EmbeddedSubtitleStream> {
    let ffmpeg_path = resolve_binary_path(app, "ffmpeg.exe");
    let output = match hidden_command(ffmpeg_path)
        .args(["-hide_banner", "-i", path])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut fallback_tracks = Vec::new();
    let mut seen_indexes = BTreeSet::new();

    for line in stderr.lines() {
        if !line.contains("Stream #") || !line.contains("Subtitle:") {
            continue;
        }

        let Some(after_stream_marker) = line.split("Stream #").nth(1) else {
            continue;
        };
        let mut stream_parts = after_stream_marker.splitn(3, ':');
        let Some(_input_index) = stream_parts.next() else {
            continue;
        };
        let Some(stream_descriptor) = stream_parts.next() else {
            continue;
        };
        let Some(stream_kind) = stream_parts.next() else {
            continue;
        };

        let stream_index: String = stream_descriptor
            .chars()
            .skip_while(|character| !character.is_ascii_digit())
            .take_while(|character| character.is_ascii_digit())
            .collect();
        let Ok(stream_index) = stream_index.parse::<usize>() else {
            continue;
        };
        if !seen_indexes.insert(stream_index) {
            continue;
        }

        let language = stream_descriptor
            .rsplit_once('(')
            .and_then(|(_, remainder)| remainder.strip_suffix(')'))
            .unwrap_or("")
            .trim()
            .to_string();

        let codec = stream_kind
            .split("Subtitle:")
            .nth(1)
            .unwrap_or("")
            .split(',')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();

        fallback_tracks.push(EmbeddedSubtitleStream {
            index: stream_index,
            label: format_stream_label("", &language, "Embedded", fallback_tracks.len()),
            detail: format_stream_detail(&language, &codec),
        });
    }

    fallback_tracks
}

#[cfg(target_os = "windows")]
fn list_system_fonts_impl() -> Vec<String> {
    let mut fonts = BTreeSet::new();

    fn append_fonts_from_registry(
        root_key: &RegKey,
        subkey_path: &str,
        fonts: &mut BTreeSet<String>,
    ) {
        let Ok(fonts_key) = root_key.open_subkey(subkey_path) else {
            return;
        };

        for registry_value in fonts_key.enum_values().flatten() {
            let cleaned = registry_value
                .0
                .replace(" (TrueType)", "")
                .replace(" (OpenType)", "")
                .replace(" (All res)", "")
                .replace(" (120)", "");

            for name in cleaned.split('&') {
                let candidate = name.trim().trim_start_matches('@');
                if !candidate.is_empty() {
                    fonts.insert(candidate.to_string());
                }
            }
        }
    }

    append_fonts_from_registry(
        &RegKey::predef(HKEY_LOCAL_MACHINE),
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        &mut fonts,
    );
    append_fonts_from_registry(
        &RegKey::predef(HKEY_CURRENT_USER),
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        &mut fonts,
    );

    fonts.into_iter().collect()
}

#[cfg(not(target_os = "windows"))]
fn list_system_fonts_impl() -> Vec<String> {
    vec![
        "Arial".into(),
        "Helvetica".into(),
        "Times New Roman".into(),
        "Verdana".into(),
        "Georgia".into(),
    ]
}

#[tauri::command]
fn get_launch_video(state: State<'_, LaunchVideoState>) -> Option<String> {
    state.pending_video.lock().ok()?.take()
}

#[tauri::command]
fn read_local_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn find_matching_external_subtitle(path: String) -> Result<Option<String>, String> {
    find_matching_external_subtitle_path(Path::new(&path))
        .map(|match_path| match_path.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_devtools(window: WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    list_system_fonts_impl()
}

#[tauri::command]
fn list_folder_videos(path: String) -> Result<Vec<PlaylistVideo>, String> {
    let video_path = Path::new(&path);
    if !video_path.exists() || !video_path.is_file() {
        return Ok(vec![]);
    }

    let Some(folder_path) = video_path.parent() else {
        return Ok(vec![]);
    };

    let mut videos = Vec::new();
    for entry in fs::read_dir(folder_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }

        let Some(extension) = entry_path.extension() else {
            continue;
        };
        if !is_supported_video_extension(extension) {
            continue;
        }

        videos.push(PlaylistVideo {
            path: entry_path.to_string_lossy().to_string(),
            file_name: entry.file_name().to_string_lossy().to_string(),
        });
    }

    videos.sort_by(|left, right| {
        left.file_name
            .to_ascii_lowercase()
            .cmp(&right.file_name.to_ascii_lowercase())
            .then_with(|| left.file_name.cmp(&right.file_name))
    });

    Ok(videos)
}

fn probe_video_duration_seconds(app: &AppHandle, path: &str) -> Result<f64, String> {
    let ffprobe_path = resolve_binary_path(app, "ffprobe.exe");
    let output = hidden_command(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe could not read the video duration.".into()
        } else {
            stderr
        });
    }

    let raw_duration = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let duration = raw_duration
        .parse::<f64>()
        .map_err(|_| "ffprobe did not report a usable video duration.".to_string())?;

    if !duration.is_finite() || duration <= 0.0 {
        return Err("ffprobe reported an invalid video duration.".into());
    }

    Ok(duration)
}

#[tauri::command]
fn prepare_hls_stream(
    app: AppHandle,
    state: State<'_, TsStreamServerState>,
    path: String,
) -> Result<TsStreamSource, String> {
    if !Path::new(&path).exists() {
        return Err("Video file not found.".into());
    }

    let duration_seconds = probe_video_duration_seconds(&app, &path)?;
    let segment_count = (duration_seconds / HLS_SEGMENT_SECONDS).ceil().max(1.0) as usize;
    let session_id = format!("{:016x}", hls_cache_key(&path)?);
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .or_else(|_| app.path().temp_dir())
        .map_err(|error| error.to_string())?
        .join("hls-cache")
        .join(&session_id);
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    let streams = probe_streams(&app, &path).unwrap_or_default();
    let audio_codec = streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("audio"))
        .and_then(|stream| stream.codec_name.as_deref())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let copy_video = false;
    let copy_audio = matches!(audio_codec.as_str(), "aac" | "mp3");
    let server = ensure_ts_stream_server(&state)?;
    let session = TsStreamSession {
        path,
        duration_seconds,
        segment_seconds: HLS_SEGMENT_SECONDS,
        segment_count,
        cache_dir,
        ffmpeg_path: resolve_binary_path(&app, "ffmpeg.exe"),
        copy_video,
        copy_audio,
    };

    server
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .insert(session_id.clone(), session);

    Ok(TsStreamSource {
        playlist_url: format!(
            "http://127.0.0.1:{}/hls/{session_id}/playlist.m3u8",
            server.port
        ),
        duration_seconds,
    })
}

#[tauri::command]
fn list_embedded_subtitle_streams(
    app: AppHandle,
    path: String,
) -> Result<Vec<EmbeddedSubtitleStream>, String> {
    if !Path::new(&path).exists() {
        return Ok(vec![]);
    }

    let subtitle_streams: Vec<EmbeddedSubtitleStream> = match probe_streams(&app, &path) {
        Ok(streams) => streams
            .into_iter()
            .filter(|stream| {
                stream.codec_type.as_deref() == Some("subtitle")
                    || stream
                        .codec_name
                        .as_deref()
                        .map(is_known_subtitle_codec)
                        .unwrap_or(false)
            })
            .enumerate()
            .map(|(position, stream)| {
                let language = stream
                    .tags
                    .as_ref()
                    .and_then(|tags| tags.language.as_deref())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let title = stream
                    .tags
                    .as_ref()
                    .and_then(|tags| tags.title.as_deref())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let codec = stream.codec_name.unwrap_or_default().trim().to_string();

                let _legacy_label = if !title.is_empty() {
                    title.clone()
                } else if !language.is_empty() {
                    language.to_uppercase()
                } else {
                    format!("Embedded {}", position + 1)
                };

                let mut _legacy_detail_parts = Vec::new();
                if !language.is_empty() {
                    _legacy_detail_parts.push(language.to_uppercase());
                }
                if !codec.is_empty() {
                    _legacy_detail_parts.push(codec.to_uppercase());
                }

                let label = format_stream_label(&title, &language, "Embedded", position);
                let detail = format_stream_detail(&language, &codec);
                let detail_parts = [detail];

                EmbeddedSubtitleStream {
                    index: stream.index,
                    label,
                    detail: detail_parts.join(" • "),
                }
            })
            .collect(),
        Err(_) => fallback_subtitle_streams(&app, &path),
    };

    Ok(subtitle_streams)
}

#[tauri::command]
async fn extract_embedded_subtitle_stream(
    app: AppHandle,
    path: String,
    stream_index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).exists() {
            return Err("Video file not found.".into());
        }

        let cache_dir = app
            .path()
            .app_local_data_dir()
            .or_else(|_| app.path().temp_dir())
            .map_err(|error| error.to_string())?
            .join("subtitle-cache");
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

        let cache_file = cache_dir.join(format!("{:016x}-s{}.vtt", cache_key(&path), stream_index));
        if cache_file.exists() {
            return fs::read_to_string(&cache_file).map_err(|error| error.to_string());
        }

        let map_value = format!("0:{stream_index}");
        let ffmpeg_path = resolve_binary_path(&app, "ffmpeg.exe");
        let output = hidden_command(ffmpeg_path)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-i",
                &path,
                "-map",
                &map_value,
                "-f",
                "webvtt",
                "-y",
                cache_file
                    .to_str()
                    .ok_or_else(|| "Invalid cache path.".to_string())?,
            ])
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "ffmpeg could not extract that subtitle stream.".into()
            } else {
                stderr
            });
        }

        fs::read_to_string(&cache_file).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn extract_embedded_audio_stream(
    app: AppHandle,
    path: String,
    stream_index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).exists() {
            return Err("Video file not found.".into());
        }

        let cache_dir = app
            .path()
            .app_local_data_dir()
            .or_else(|_| app.path().temp_dir())
            .map_err(|error| error.to_string())?
            .join("audio-cache");
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

        let cache_file = cache_dir.join(format!("{:016x}-a{}.m4a", cache_key(&path), stream_index));
        if cache_file.exists() {
            return Ok(cache_file.to_string_lossy().to_string());
        }

        let map_value = format!("0:{stream_index}");
        let ffmpeg_path = resolve_binary_path(&app, "ffmpeg.exe");
        let output = hidden_command(ffmpeg_path)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-i",
                &path,
                "-map",
                &map_value,
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-y",
                cache_file
                    .to_str()
                    .ok_or_else(|| "Invalid cache path.".to_string())?,
            ])
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "ffmpeg could not extract that audio stream.".into()
            } else {
                stderr
            });
        }

        Ok(cache_file.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prepare_video_playback_source(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&path).exists() {
            return Err("Video file not found.".into());
        }

        let requires_fallback = if is_transport_stream_path(&path) {
            true
        } else {
            probe_streams(&app, &path)
                .ok()
                .and_then(|streams| {
                    streams
                        .into_iter()
                        .find(|stream| stream.codec_type.as_deref() == Some("video"))
                })
                .map(|stream| video_stream_requires_browser_fallback(&stream))
                .unwrap_or(false)
        };

        if !requires_fallback {
            return Ok(path);
        }

        let cache_dir = app
            .path()
            .app_local_data_dir()
            .or_else(|_| app.path().temp_dir())
            .map_err(|error| error.to_string())?
            .join("playback-cache");
        fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

        let playback_key = playback_cache_key(&path)?;
        let cache_file = cache_dir.join(format!("{playback_key:016x}.mp4"));
        if cache_file_is_usable(&cache_file) {
            return Ok(cache_file.to_string_lossy().to_string());
        }
        if cache_file.exists() {
            let _ = fs::remove_file(&cache_file);
        }

        let partial_file = cache_dir.join(format!("{playback_key:016x}.partial.mp4"));
        if partial_file.exists() {
            let _ = fs::remove_file(&partial_file);
        }

        let ffmpeg_path = resolve_binary_path(&app, "ffmpeg.exe");
        let output = hidden_command(ffmpeg_path)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-analyzeduration",
                "100M",
                "-probesize",
                "100M",
                "-err_detect",
                "ignore_err",
                "-fflags",
                "+genpts",
                "-i",
                &path,
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-dn",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ac",
                "2",
                "-avoid_negative_ts",
                "make_zero",
                "-max_muxing_queue_size",
                "1024",
                "-movflags",
                "+faststart",
                "-y",
                partial_file
                    .to_str()
                    .ok_or_else(|| "Invalid playback cache path.".to_string())?,
            ])
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            let _ = fs::remove_file(&partial_file);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "ffmpeg could not prepare that video for playback.".into()
            } else {
                stderr
            });
        }

        if !cache_file_is_usable(&partial_file) {
            let _ = fs::remove_file(&partial_file);
            return Err("ffmpeg prepared an empty video playback file.".into());
        }

        fs::rename(&partial_file, &cache_file)
            .or_else(|_| {
                fs::copy(&partial_file, &cache_file)?;
                fs::remove_file(&partial_file)?;
                Ok::<(), std::io::Error>(())
            })
            .map_err(|error| error.to_string())?;

        Ok(cache_file.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn list_embedded_audio_streams(
    app: AppHandle,
    path: String,
) -> Result<Vec<EmbeddedAudioStream>, String> {
    if !Path::new(&path).exists() {
        return Ok(vec![]);
    }

    Ok(probe_streams(&app, &path)?
        .into_iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .enumerate()
        .map(|(position, stream)| {
            let language = stream
                .tags
                .as_ref()
                .and_then(|tags| tags.language.as_deref())
                .unwrap_or("")
                .trim()
                .to_string();
            let title = stream
                .tags
                .as_ref()
                .and_then(|tags| tags.title.as_deref())
                .unwrap_or("")
                .trim()
                .to_string();
            let codec = stream.codec_name.unwrap_or_default().trim().to_string();

            let _legacy_label = if !title.is_empty() {
                title.clone()
            } else if !language.is_empty() {
                language.to_uppercase()
            } else {
                format!("Audio {}", position + 1)
            };

            let mut _legacy_detail_parts = Vec::new();
            if !language.is_empty() {
                _legacy_detail_parts.push(language.to_uppercase());
            }
            if !codec.is_empty() {
                _legacy_detail_parts.push(codec.to_uppercase());
            }

            let label = format_stream_label(&title, &language, "Audio", position);
            let detail = format_stream_detail(&language, &codec);
            let detail_parts = [detail];

            EmbeddedAudioStream {
                index: stream.index,
                order: position,
                label,
                codec,
                detail: detail_parts.join(" • "),
            }
        })
        .collect())
}

fn unique_file_path(target_dir: &Path, preferred_name: &str) -> PathBuf {
    let preferred_path = target_dir.join(preferred_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let stem = Path::new(preferred_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("subtitle");
    let extension = Path::new(preferred_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    for index in 1..=9_999 {
        let candidate_name = if extension.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{extension}")
        };
        let candidate_path = target_dir.join(candidate_name);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }

    preferred_path
}

#[tauri::command]
fn save_subtitle_to_downloads(
    app: AppHandle,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|path| path.join("Downloads")))
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let target_path = unique_file_path(&downloads_dir, &file_name);
    fs::write(&target_path, content).map_err(|error| error.to_string())?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
fn syncplay_update_status(
    state: State<'_, SyncplayControlState>,
    status: SyncplayStatus,
) -> Result<(), String> {
    let mut current_status = state.status.lock().map_err(|error| error.to_string())?;
    *current_status = status;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_video = find_first_video_arg(std::env::args().skip(1));

    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = find_first_video_arg(argv.into_iter().skip(1)) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }

                let _ = app.emit("open-file", OpenFilePayload { path });
            }
        }))
        .manage(LaunchVideoState {
            pending_video: Mutex::new(initial_video),
        })
        .manage(TsStreamServerState::default())
        .manage(SyncplayControlState::default())
        .invoke_handler(tauri::generate_handler![
            get_launch_video,
            read_local_file_bytes,
            find_matching_external_subtitle,
            open_devtools,
            list_system_fonts,
            list_folder_videos,
            prepare_hls_stream,
            prepare_video_playback_source,
            list_embedded_subtitle_streams,
            list_embedded_audio_streams,
            extract_embedded_subtitle_stream,
            extract_embedded_audio_stream,
            save_subtitle_to_downloads,
            syncplay_update_status
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let status = app.state::<SyncplayControlState>().status.clone();
            start_syncplay_control_server(app.handle().clone(), status)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video_stream(codec_name: &str, pix_fmt: &str) -> FfprobeStream {
        FfprobeStream {
            index: 0,
            codec_type: Some("video".into()),
            codec_name: Some(codec_name.into()),
            pix_fmt: Some(pix_fmt.into()),
            tags: None,
        }
    }

    #[test]
    fn recognizes_supported_extensions_case_insensitively() {
        assert!(is_supported_video_extension(OsStr::new("MKV")));
        assert!(is_supported_video_extension(OsStr::new("ts")));
        assert!(!is_supported_video_extension(OsStr::new("txt")));
        assert!(is_supported_external_subtitle_extension(OsStr::new("SRT")));
        assert!(is_supported_external_subtitle_extension(OsStr::new("PGS")));
        assert!(!is_supported_external_subtitle_extension(OsStr::new("mp4")));
        assert!(is_transport_stream_path("episode.M2TS"));
        assert!(!is_transport_stream_path("episode.mp4"));
    }

    #[test]
    fn selects_only_the_exact_video_basename_subtitle() {
        let unique_suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "noir-player-subtitle-match-{}-{unique_suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();

        let video_path = directory.join("Film.2026.mkv");
        fs::write(&video_path, b"fixture").unwrap();
        fs::write(directory.join("Film.2026.ass"), b"ass").unwrap();
        fs::write(directory.join("Film.2026.srt"), b"srt").unwrap();
        fs::write(directory.join("Film.2026.es.srt"), b"different stem").unwrap();
        fs::write(directory.join("Film.2026.subtitled.mp4"), b"video").unwrap();

        let match_path = find_matching_external_subtitle_path(&video_path)
            .unwrap()
            .unwrap();
        assert_eq!(
            match_path.file_name().and_then(OsStr::to_str),
            Some("Film.2026.srt")
        );

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn detects_browser_fallback_codecs_and_pixel_formats() {
        assert!(!video_stream_requires_browser_fallback(&video_stream(
            "h264", "yuv420p"
        )));
        assert!(video_stream_requires_browser_fallback(&video_stream(
            "hevc", "yuv420p"
        )));
        assert!(video_stream_requires_browser_fallback(&video_stream(
            "h264",
            "yuv420p10le"
        )));
        assert!(video_stream_requires_browser_fallback(&video_stream(
            "h264", "yuv422p"
        )));
    }

    #[test]
    fn builds_a_complete_vod_hls_playlist() {
        let session = TsStreamSession {
            path: "episode.ts".into(),
            duration_seconds: 3.5,
            segment_seconds: 2.0,
            segment_count: 2,
            cache_dir: PathBuf::from("cache"),
            ffmpeg_path: PathBuf::from("ffmpeg"),
            copy_video: true,
            copy_audio: true,
        };
        let playlist = build_hls_playlist(&session);
        assert!(playlist.starts_with("#EXTM3U"));
        assert!(playlist.contains("#EXT-X-TARGETDURATION:2"));
        assert!(playlist.contains("#EXTINF:2.000"));
        assert!(playlist.contains("#EXTINF:1.500"));
        assert!(playlist.contains("segment/0.ts"));
        assert!(playlist.contains("segment/1.ts"));
        assert!(playlist.ends_with("#EXT-X-ENDLIST\n"));
    }

    #[test]
    fn parses_control_server_ports() {
        assert_eq!(parse_server_port(SYNCPLAY_CONTROL_ADDR).unwrap(), 32123);
        assert!(parse_server_port("127.0.0.1:not-a-port").is_err());
    }

    #[test]
    fn keeps_syncplay_wire_format_stable() {
        let command = SyncplayCommand {
            command: "seek".into(),
            position: Some(12.5),
            rate: None,
            path: None,
            message: None,
            muted: None,
        };
        let command_json = serde_json::to_value(command).unwrap();
        assert_eq!(command_json["command"], "seek");
        assert_eq!(command_json["position"], 12.5);

        let status = SyncplayStatus {
            loaded: true,
            paused: false,
            position: 12.5,
            duration: 90.0,
            rate: 1.25,
            path: Some("C:\\Videos\\episode.mkv".into()),
            file_name: Some("episode.mkv".into()),
        };
        let status_json = serde_json::to_value(status).unwrap();
        assert_eq!(status_json["fileName"], "episode.mkv");
        assert_eq!(status_json["path"], "C:\\Videos\\episode.mkv");
    }
}
