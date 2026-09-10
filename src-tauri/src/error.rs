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
    #[error("{0} is not a known palette colour")]
    UnknownColor(String),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("could not encode value: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::WindowNotFound(_) => "window_not_found",
            Self::DockUnavailable => "dock_unavailable",
            Self::NoteNotFound(_) => "note_not_found",
            Self::UnknownColor(_) => "unknown_color",
            Self::Database(_) => "database",
            Self::Serde(_) => "serde",
            Self::Tauri(_) => "tauri",
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
