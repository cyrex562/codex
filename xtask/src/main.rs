//! Cross-platform build + deploy automation for Librarium.
//!
//! Run via the cargo alias defined in `.cargo/config.toml`:
//!
//!   cargo xtask build-desktop           # release build of the desktop app
//!   cargo xtask build-desktop --debug   # faster, unoptimized build
//!   cargo xtask build-frontend          # just (re)build the Vue SPA
//!   cargo xtask run-desktop [--debug]   # build + launch the desktop app
//!   cargo xtask deploy [TARGET] [...]   # deploy the server to a remote target
//!   cargo xtask status [TARGET]         # check a target's health/version
//!   cargo xtask logs   [TARGET]         # stream a target's logs
//!   cargo xtask doctor [TARGET]         # preflight a target
//!
//! The build commands are self-contained. The deploy/status/logs/doctor
//! commands are thin pass-throughs to `scripts/librarium.py`, so this crate is
//! the single entry point for the whole build→deploy→observe loop (build
//! commands need Node+Rust; the ops commands additionally need Python 3 with the
//! script's deps installed).
//!
//! The desktop app embeds the server, which embeds the Vue SPA from
//! `target/frontend/` via rust-embed — so the frontend MUST be built before the
//! Rust build. `build-desktop`/`run-desktop` handle that ordering for you.
//!
//! Prerequisites for the build commands: Rust (rustup), Node.js + npm, and the
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
        // Ops commands: forward verbatim (including the command name and any
        // target/flags) to the deployment CLI.
        "deploy" | "status" | "logs" | "doctor" | "targets" => librarium_cli(&args),
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
        "Librarium tasks:\n\
         \n  Build:\
         \n    cargo xtask build-desktop [--debug]   Build the desktop app (frontend + Tauri)\
         \n    cargo xtask run-desktop   [--debug]   Build then launch the desktop app\
         \n    cargo xtask build-frontend            Build only the Vue SPA into target/frontend\
         \n  Deploy / observe (via scripts/librarium.py; needs: pip install -r scripts/requirements.txt):\
         \n    cargo xtask deploy [TARGET] [flags]   Deploy the server to a remote target\
         \n    cargo xtask status [TARGET]           Show a target's running version/health\
         \n    cargo xtask logs   [TARGET]           Stream a target's logs\
         \n    cargo xtask doctor [TARGET]           Preflight a target\
         \n    cargo xtask targets                   List configured deploy targets\
         \n\nBuild profile defaults to release; pass --debug for a faster, unoptimized build.\
         \nTARGET names come from targets.toml (omit to be prompted)."
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
    run(
        Command::new("cargo").args(&args).current_dir(&root),
        "cargo build",
    );

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
    run(
        Command::new("cargo").args(&args).current_dir(&root),
        "cargo run",
    );
}

/// Forward a command to the deployment CLI (`scripts/librarium.py`), passing the
/// xtask args through verbatim so `cargo xtask deploy librarium-01 --skip-backup`
/// becomes `python scripts/librarium.py deploy librarium-01 --skip-backup`.
fn librarium_cli(args: &[String]) {
    let root = repo_root();
    let script = root.join("scripts").join("librarium.py");
    if !script.exists() {
        eprintln!("✗ deployment CLI not found at {}", script.display());
        exit(1);
    }
    let mut cmd = Command::new(python_exe());
    cmd.arg(&script).args(args).current_dir(&root);
    run(&mut cmd, "librarium.py");
}

/// Pick a Python interpreter: prefer `python3`, fall back to `python` (Windows).
fn python_exe() -> &'static str {
    for cand in ["python3", "python"] {
        let ok = Command::new(cand)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return cand;
        }
    }
    // Neither found; return the common default so `run` surfaces a clear error.
    "python3"
}

/// Invoke npm portably. On Windows `npm` is a `.cmd` shim that `Command` won't
/// resolve directly, so route it through `cmd /C`.
fn npm(dir: &Path, args: &[&str]) {
    if cfg!(windows) {
        let line = format!("npm {}", args.join(" "));
        run(
            Command::new("cmd").arg("/C").arg(line).current_dir(dir),
            "npm",
        );
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
