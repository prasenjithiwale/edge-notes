//! Edge docking: pure geometry, a pure state machine, and the thread that
//! connects them to Tauri.

pub mod controller;
pub mod geometry;
pub mod poller;

pub use controller::{Action, DockController, DockState, Input, OpenTrigger, Phase, Timings};
pub use geometry::{DockGeometry, Metrics, Rect, Side};
pub use poller::{DOCK_STATE_EVENT, DOCK_WINDOW_LABEL, Dock, PRIMARY_MONITOR, Placement};
