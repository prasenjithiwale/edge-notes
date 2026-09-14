//! Opening a link from a note in the user's browser (lightweight formatting).
//!
//! The webview has no shell or opener permission (brief 9.5), and following a
//! link inside it would navigate the widget itself away. So this one typed
//! command accepts web links only and hands them to the operating system as a
//! single process argument — never through a shell, so nothing in the URL can be
//! interpreted as a command.

use std::process::Command;

use crate::error::{AppError, AppResult};

/// Longer than any link a person pastes into a note; anything past it is junk.
const MAX_URL_LEN: usize = 2_048;

/// `http` and `https` only, with a host, no whitespace and no control characters —
/// the same links the frontend recognises in note text.
pub fn validate(url: &str) -> AppResult<&str> {
    let has_scheme = |scheme: &str| {
        url.get(..scheme.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
    };
    let rest = if has_scheme("https://") {
        &url[8..]
    } else if has_scheme("http://") {
        &url[7..]
    } else {
        return Err(AppError::InvalidUrl(url.chars().take(64).collect()));
    };

    let clean = !url
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control() || ch == '"');
    if rest.is_empty() || rest.starts_with('/') || url.len() > MAX_URL_LEN || !clean {
        return Err(AppError::InvalidUrl(url.chars().take(64).collect()));
    }
    Ok(url)
}

/// Open `url` in the default browser.
pub fn open(url: &str) -> AppResult<()> {
    let url = validate(url)?;
    let mut child = opener(url).spawn()?;
    // The launcher exits as soon as it has handed the URL over. Wait for it on a
    // throwaway thread so it is reaped rather than left as a zombie, without
    // holding up the command.
    std::thread::spawn(move || {
        if let Err(error) = child.wait() {
            log::warn!("links: the URL opener did not exit cleanly: {error}");
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn opener(url: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.arg(url);
    command
}

#[cfg(target_os = "windows")]
fn opener(url: &str) -> Command {
    let mut command = Command::new("rundll32");
    command.args(["url.dll,FileProtocolHandler", url]);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn opener(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_web_links_in_any_case() {
        for url in [
            "https://example.com",
            "http://example.com/a_b?c=d&e=f#g",
            "HTTPS://Example.com/Path",
            "https://en.wikipedia.org/wiki/Tea_(meal)",
        ] {
            assert_eq!(validate(url).ok(), Some(url), "{url}");
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_web_link() {
        for url in [
            "",
            "https://",
            "http:///etc/passwd",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:someone@example.com",
            "-a Calculator",
            "example.com",
            "ftp://example.com",
        ] {
            assert!(validate(url).is_err(), "{url}");
        }
    }

    #[test]
    fn refuses_whitespace_quotes_and_control_characters() {
        for url in [
            "https://example.com/a b",
            "https://example.com/\nnext",
            "https://example.com/\"quoted\"",
            "https://example.com/\u{0}",
        ] {
            assert!(validate(url).is_err(), "{url:?}");
        }
    }

    #[test]
    fn refuses_an_absurdly_long_link() {
        let url = format!("https://example.com/{}", "a".repeat(MAX_URL_LEN));
        assert!(validate(&url).is_err());
    }

    #[test]
    fn a_non_ascii_prefix_is_an_error_not_a_panic() {
        assert!(validate("ħttps://example.com").is_err());
        assert!(validate("ht").is_err());
    }
}
