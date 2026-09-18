//! Every command returns `Result<T, AppError>`, serialized as `{ code, message }`
//! (brief 9.3), so the frontend never has to parse error strings.

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("the {0} window is not available")]
    WindowNotFound(&'static str),
    #[error("the dock is not initialised")]
    DockUnavailable,
    #[error("no note with id {0}")]
    NoteNotFound(String),
    #[error("no task with id {0}")]
    TaskNotFound(String),
    #[error("{1} is not a known task {0}")]
    UnknownTaskField(&'static str, String),
    #[error("{0} is not a known palette colour")]
    UnknownColor(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("could not encode value: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a web link: {0}")]
    InvalidUrl(String),
    #[error("{0}")]
    ShortcutUnavailable(String),
    #[error("launch at login could not be changed: {0}")]
    Autostart(String),
    /// The notes are encrypted and the key on offer does not open them
    /// (`db::vault`). Its own code, because the panel's locked view has to tell
    /// a wrong key from a database that would not open at all.
    #[error("{0}")]
    Locked(String),
}

impl AppError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::WindowNotFound(_) => "window_not_found",
            Self::DockUnavailable => "dock_unavailable",
            Self::NoteNotFound(_) => "note_not_found",
            Self::TaskNotFound(_) => "task_not_found",
            Self::UnknownTaskField(..) => "unknown_task_field",
            Self::UnknownColor(_) => "unknown_color",
            Self::Database(_) => "database",
            Self::Serde(_) => "serde",
            Self::Tauri(_) => "tauri",
            Self::Io(_) => "io",
            Self::InvalidUrl(_) => "invalid_url",
            Self::ShortcutUnavailable(_) => "shortcut_unavailable",
            Self::Autostart(_) => "autostart",
            Self::Locked(_) => "locked",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
