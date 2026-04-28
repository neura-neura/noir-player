use std::{
    collections::BTreeSet,
    ffi::OsStr,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
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

#[derive(Default)]
struct LaunchVideoState {
    pending_video: Mutex<Option<String>>,
}

#[derive(Clone, serde::Serialize)]
struct OpenFilePayload {
    path: String,
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
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            SUPPORTED_VIDEO_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or(false)
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
            "stream=index,codec_type,codec_name:stream_tags=language,title",
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
fn open_devtools(window: WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    list_system_fonts_impl()
}

#[tauri::command]
fn list_embedded_subtitle_streams(
    app: AppHandle,
    path: String,
) -> Result<Vec<EmbeddedSubtitleStream>, String> {
    if !Path::new(&path).exists() {
        return Ok(vec![]);
    }

    let mut subtitle_streams: Vec<EmbeddedSubtitleStream> = probe_streams(&app, &path)
        .unwrap_or_default()
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
            let detail_parts = vec![detail];

            EmbeddedSubtitleStream {
                index: stream.index,
                label,
                detail: detail_parts.join(" • "),
            }
        })
        .collect();

    if subtitle_streams.is_empty() {
        subtitle_streams = fallback_subtitle_streams(&app, &path);
    }

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

        let cache_file = cache_dir.join(format!(
            "{:016x}-s{}.vtt",
            cache_key(&path),
            stream_index
        ));
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

        let cache_file = cache_dir.join(format!(
            "{:016x}-a{}.m4a",
            cache_key(&path),
            stream_index
        ));
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
            let detail_parts = vec![detail];

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_video = find_first_video_arg(std::env::args().skip(1));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        .invoke_handler(tauri::generate_handler![
            get_launch_video,
            open_devtools,
            list_system_fonts,
            list_embedded_subtitle_streams,
            list_embedded_audio_streams,
            extract_embedded_subtitle_stream,
            extract_embedded_audio_stream,
            save_subtitle_to_downloads
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


