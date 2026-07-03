//! Cross-platform build automation for Librarium.
//!
//! Run via the cargo alias defined in `.cargo/config.toml`:
//!
//!   cargo xtask build-desktop           # release build of the desktop app
//!   cargo xtask build-desktop --debug   # faster, unoptimized build
//!   cargo xtask build-frontend          # just (re)build the Vue SPA
//!   cargo xtask run-desktop [--debug]   # build + launch the desktop app
//!
//! The desktop app embeds the server, which embeds the Vue SPA from
//! `target/frontend/` via rust-embed — so the frontend MUST be built before the
//! Rust build. `build-desktop`/`run-desktop` handle that ordering for you.
//!
//! Prerequisites on the build machine: Rust (rustup), Node.js + npm, and the
//! platform's Tauri/WebView deps. On Windows that means the WebView2 runtime
//! (preinstalled on Win11 and most Win10); on Linux the webkit2gtk-4.1 / gtk3
//! dev packages.

use std::path::{Path, PathBuf};
use std::process::{exit, Command};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let release = !args.iter().any(|a| a == "--debug");

    match cmd {
        "build-frontend" => build_frontend(),
        "build-desktop" => {
            build_frontend();
            build_desktop(release);
        }
        "run-desktop" => {
            build_frontend();
            run_desktop(release);
        }
        "help" | "-h" | "--help" => help(),
        other => {
            eprintln!("unknown command: {other}\n");
            help();
            exit(2);
        }
    }
}

fn help() {
    println!(
        "Librarium build tasks:\n\
         \n  cargo xtask build-desktop [--debug]   Build the desktop app (frontend + Tauri)\
         \n  cargo xtask run-desktop   [--debug]   Build then launch the desktop app\
         \n  cargo xtask build-frontend            Build only the Vue SPA into target/frontend\
         \n\nDefault profile is release; pass --debug for a faster, unoptimized build."
    );
}

/// Workspace root, derived from this crate's location (xtask/ lives at the root).
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask has a parent dir")
        .to_path_buf()
}

fn build_frontend() {
    let frontend = repo_root().join("frontend");
    // Install deps on first run (or after a clean checkout).
    if !frontend.join("node_modules").exists() {
        eprintln!("→ frontend/node_modules missing — running npm ci");
        npm(&frontend, &["ci"]);
    }
    eprintln!("→ building frontend (vue-tsc + vite) into target/frontend");
    npm(&frontend, &["run", "build"]);
}

fn build_desktop(release: bool) {
    let root = repo_root();
    let mut args = vec!["build", "-p", "librarium-tauri"];
    if release {
        args.push("--release");
    }
    eprintln!("→ cargo {}", args.join(" "));
    run(Command::new("cargo").args(&args).current_dir(&root), "cargo build");

    let profile = if release { "release" } else { "debug" };
    let bin = if cfg!(windows) {
        "librarium-tauri.exe"
    } else {
        "librarium-tauri"
    };
    println!("\n✓ Desktop build ready: target/{profile}/{bin}");
    println!(
        "  Run it directly, or for a distributable installer use the Tauri CLI\n\
         (cargo install tauri-cli && cargo tauri build) which emits an NSIS \
         installer on Windows."
    );
}

fn run_desktop(release: bool) {
    let root = repo_root();
    let mut args = vec!["run", "-p", "librarium-tauri"];
    if release {
        args.push("--release");
    }
    eprintln!("→ cargo {}", args.join(" "));
    run(Command::new("cargo").args(&args).current_dir(&root), "cargo run");
}

/// Invoke npm portably. On Windows `npm` is a `.cmd` shim that `Command` won't
/// resolve directly, so route it through `cmd /C`.
fn npm(dir: &Path, args: &[&str]) {
    if cfg!(windows) {
        let line = format!("npm {}", args.join(" "));
        run(Command::new("cmd").arg("/C").arg(line).current_dir(dir), "npm");
    } else {
        run(Command::new("npm").args(args).current_dir(dir), "npm");
    }
}

fn run(cmd: &mut Command, label: &str) {
    match cmd.status() {
        Ok(status) if status.success() => {}
        Ok(status) => {
            eprintln!("✗ {label} failed with {status}");
            exit(status.code().unwrap_or(1));
        }
        Err(e) => {
            eprintln!("✗ could not launch {label}: {e}");
            exit(1);
        }
    }
}
