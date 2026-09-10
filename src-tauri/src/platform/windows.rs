//! Windows: `skipTaskbar` and `alwaysOnTop` from tauri.conf.json cover the
//! behaviour we need. Brief 8.9 says to verify in M0 that expanding the window
//! does not steal focus before adding any extended window styles, so nothing is
//! added here yet.

use tauri::WebviewWindow;

pub fn configure(_window: &WebviewWindow) {}
