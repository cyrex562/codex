#!/usr/bin/env python3
import subprocess
import sys
import os

def print_header(title):
    print(f"\n{'='*80}\n== {title}\n{'='*80}")

def run_step(name, cmd, cwd=None):
    print_header(f"Running {name}")
    try:
        # Use shell=True so we can easily run things like 'npx' without finding the exact executable
        subprocess.run(cmd, cwd=cwd, shell=True, check=True)
        print(f"✅ {name} Completed Successfully!")
    except subprocess.CalledProcessError as e:
        print(f"❌ {name} Failed with exit code {e.returncode}")
        sys.exit(e.returncode)

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frontend_dir = os.path.join(root_dir, "frontend")

    # 1. Unit & Property Tests
    # "cargo test" automatically picks up standard unit tests and any proptest/quickcheck properties defined inside the rust crates.
    run_step("Rust Unit & Property Tests", "cargo test --all-features", cwd=root_dir)

    # 2. Mutation Testing
    # Uses `cargo-mutants` (install via `cargo install cargo-mutants` if missing)
    run_step("Mutation Tests", "cargo mutants --no-shuffle", cwd=root_dir)

    # 3. Playwright (Web E2E)
    # Assumes playwright is installed inside the frontend folder
    if os.path.exists(frontend_dir):
        run_step("Playwright Web E2E", "npm ci && npx playwright test", cwd=frontend_dir)
    else:
        print("⚠️ Frontend directory not found; skipping Playwright tests.")

    # 4. Desktop E2E Equivalent
    # Since obsidian-desktop is built with iced, true E2E browser-like testing doesn't natively exist like Playwright.
    # The standard approaches in Rust GUI testing involve:
    #   a) Headless window integration state tests (run via `cargo test -p obsidian-desktop`).
    #   b) Accessibility UI tree traversing (AccessKit).
    # Currently, we invoke the desktop-specific test suite which includes full-state headless integration tests.
    run_step("Desktop Headless UI / E2E Tests", "cargo test -p obsidian-desktop --test '*' --features headless", cwd=root_dir)

    print_header("🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉")

if __name__ == "__main__":
    main()
