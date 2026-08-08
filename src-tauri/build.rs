use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=lib/libmpv-2.dll");
    println!("cargo:rerun-if-changed=lib/libmpv-wrapper.dll");
    println!("cargo:rerun-if-changed=resources/bin/ffmpeg.exe");
    println!("cargo:rerun-if-changed=resources/bin/ffprobe.exe");

    stage_development_libraries();
    stage_development_binaries();
    tauri_build::build();
}

fn stage_development_libraries() {
    if !cfg!(windows) {
        return;
    }

    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };

    let out_dir = PathBuf::from(out_dir);
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };

    let source_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("lib");
    let destination_dir = profile_dir.join("lib");

    for library_name in ["libmpv-2.dll", "libmpv-wrapper.dll"] {
        let source = source_dir.join(library_name);
        let destination = destination_dir.join(library_name);

        if !source.is_file() {
            continue;
        }

        if fs::create_dir_all(&destination_dir).is_ok() {
            let _ = fs::copy(source, destination);
        }
    }
}

fn stage_development_binaries() {
    if !cfg!(windows) {
        return;
    }

    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };

    let out_dir = PathBuf::from(out_dir);
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };

    let source_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("resources")
        .join("bin");
    let destination_dir = profile_dir.join("resources").join("bin");

    for binary_name in ["ffmpeg.exe", "ffprobe.exe"] {
        let source = source_dir.join(binary_name);
        let destination = destination_dir.join(binary_name);

        if !source.is_file() {
            continue;
        }

        if fs::create_dir_all(&destination_dir).is_ok() {
            let _ = fs::copy(source, destination);
        }
    }
}
