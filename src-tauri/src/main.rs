// Windows release builds must not open a console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must be the first thing that happens: it sets an environment variable, and
    // that is only sound while the process is still single-threaded.
    #[cfg(target_os = "linux")]
    ledge_lib::platform::linux::prepare_display_backend();

    ledge_lib::run();
}
