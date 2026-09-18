//! The database key: where it comes from, where it is kept, and what happens
//! when it is not there (idea 2 in `docs/improvement-ideas.md`).
//!
//! `notes.db` is SQLCipher, not SQLite: every page is AES-256 encrypted, schema
//! included, so a backup tool, a sync folder or a stolen disk gets a file of
//! noise rather than everybody's passwords. The key is 32 random bytes kept in
//! the platform's own credential store — Keychain, Credential Manager or the
//! Secret Service — and never written beside the database it opens.
//!
//! Three things follow from that, and all three are here:
//!
//! - **The key has to come from somewhere on a fresh install.** It comes from
//!   `randomblob`, SQLite's own CSPRNG, which SQLCipher backs with OpenSSL's.
//!   That avoids a random-number dependency whose only job would be this line.
//! - **An existing plaintext database has to be carried across, once.**
//!   `sqlcipher_export` does that, but it does **not** carry `user_version`,
//!   which is how migrations are tracked: exporting and forgetting it would run
//!   every migration again on a database that already has them. `encrypt_file`
//!   copies it explicitly, and there is a test.
//! - **The key can go missing** — a new machine, a reset keychain, a restored
//!   backup — and then the notes cannot be read by anyone, this app included.
//!   That is the point of encryption and it is also a way to lose everything, so
//!   the key is never only in the keychain: Settings can show it as a recovery
//!   key, and a database whose key is missing opens `Locked` rather than being
//!   replaced.
//!
//! Nothing here ever deletes a database it cannot read.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Where the key is filed in the platform's credential store. The service is the
/// bundle identifier and the account names the file, so a future second database
/// would get its own entry rather than quietly reusing this one.
const KEYCHAIN_SERVICE: &str = "dev.ledge.app";
const KEYCHAIN_ACCOUNT: &str = "notes.db";

/// What every SQLite file starts with. SQLCipher encrypts the header too, so
/// this is also how an encrypted file is told from a plain one without a key.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// A database key: 32 bytes, held as the lower-case hex SQLCipher wants.
///
/// Only ever printed by `recovery_key`, and never logged — `Debug` is written by
/// hand so a stray `{:?}` cannot put it in a log file.
#[derive(Clone, PartialEq, Eq)]
pub struct DatabaseKey(String);

impl std::fmt::Debug for DatabaseKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DatabaseKey(<hidden>)")
    }
}

impl DatabaseKey {
    /// 32 bytes from SQLite's CSPRNG, which SQLCipher backs with OpenSSL's.
    pub fn generate() -> AppResult<Self> {
        let scratch = Connection::open_in_memory()?;
        let hex: String =
            scratch.query_row("SELECT lower(hex(randomblob(32)))", [], |row| row.get(0))?;
        Ok(Self(hex))
    }

    /// Read a key back from what someone kept. Anything that is not 32 bytes of
    /// hex is refused rather than turned into a key that opens nothing.
    pub fn parse(text: &str) -> Option<Self> {
        let hex: String = text
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .flat_map(char::to_lowercase)
            .collect();
        (hex.len() == 64).then_some(Self(hex))
    }

    /// The key as a person would write it down: eight groups of eight, which is
    /// short enough to check a character at a time against what is on screen.
    #[must_use]
    pub fn recovery_key(&self) -> String {
        self.0
            .as_bytes()
            .chunks(8)
            .map(|chunk| String::from_utf8_lossy(chunk).to_uppercase())
            .collect::<Vec<_>>()
            .join("-")
    }

    /// What `PRAGMA key` takes: a blob literal, so the bytes are the key rather
    /// than a passphrase SQLCipher would run through a key derivation first.
    fn pragma(&self) -> String {
        let mut value = String::with_capacity(self.0.len() + 3);
        let _ = write!(value, "x'{}'", self.0);
        value
    }

    /// Unlock a connection, and prove it worked. SQLCipher accepts any key
    /// without complaint — the first read is what fails — so the read is here.
    pub fn apply(&self, connection: &Connection) -> AppResult<()> {
        connection.pragma_update(None, "key", self.pragma())?;
        connection.query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
            row.get::<_, i64>(0)
        })?;
        Ok(())
    }
}

/// How the database on disk is protected, for the settings view and the panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protection {
    /// Encrypted, and open: the ordinary state.
    On,
    /// Plaintext, because this system has nowhere safe to keep a key.
    Unavailable,
    /// Encrypted, and shut: the key is gone and the notes are waiting for it.
    Locked,
}

/// The result of opening the vault at startup.
pub struct Opened {
    pub protection: Protection,
    /// The key, while the database is open and encrypted.
    pub key: Option<DatabaseKey>,
    /// Why it is not encrypted, or why it is locked. Shown to the user, so it is
    /// a sentence rather than a code.
    pub detail: String,
}

/// Ask the platform's credential store for the key.
///
/// Three answers, and they are not the same: a key, no key (a fresh install, or
/// a database that arrived without one), or no store at all — a Linux session
/// with no Secret Service, a locked keychain, a user who said no.
enum Stored {
    Key(DatabaseKey),
    Empty,
    NoStore(String),
}

fn read_key() -> Stored {
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(entry) => entry,
        Err(error) => return Stored::NoStore(describe(&error)),
    };
    match entry.get_password() {
        Ok(secret) => match DatabaseKey::parse(&secret) {
            Some(key) => Stored::Key(key),
            // A key that is not a key is not a reason to overwrite it.
            None => Stored::NoStore("the stored key is not in a form this app wrote".to_owned()),
        },
        Err(keyring::Error::NoEntry) => Stored::Empty,
        Err(error) => Stored::NoStore(describe(&error)),
    }
}

/// Put the key in the credential store. The error is returned rather than
/// logged: a key that could not be stored must not be used to encrypt anything,
/// or the next launch has a database nobody can open.
fn write_key(key: &DatabaseKey) -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| describe(&e))?;
    entry.set_password(&key.0).map_err(|e| describe(&e))
}

/// Keyring's own messages are aimed at developers; these are aimed at whoever
/// has to decide what to do about it.
fn describe(error: &keyring::Error) -> String {
    match error {
        keyring::Error::NoStorageAccess(_) => {
            "this system's keychain would not give the app access".to_owned()
        }
        keyring::Error::PlatformFailure(_) => "this system has no keychain running".to_owned(),
        other => other.to_string(),
    }
}

/// Whether the file at `path` is a plain SQLite database. A file that is not
/// there, or too short to tell, is not one.
fn is_plaintext(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    bytes.starts_with(SQLITE_HEADER)
}

/// Where the plaintext database is moved while its encrypted copy is checked.
fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("db.plaintext-backup")
}

/// Where a database whose key is gone is set aside, if the user starts again.
fn locked_aside_path(path: &Path) -> PathBuf {
    path.with_extension(format!("db.locked-{}", crate::db::now_ms()))
}

/// Open the database, encrypting it first if it is not encrypted yet.
///
/// The connection comes back unlocked and ready for migrations; the caller is
/// `Database::open`, which knows nothing about keys.
pub fn open(path: &Path) -> AppResult<(Connection, Opened)> {
    let exists = path.exists();
    let plaintext = is_plaintext(path);

    match read_key() {
        // A key, and a database it should open.
        Stored::Key(key) if exists && !plaintext => match open_encrypted(path, &key) {
            Ok(connection) => Ok((
                connection,
                Opened {
                    protection: Protection::On,
                    key: Some(key),
                    detail: String::new(),
                },
            )),
            // The key in the keychain does not open this file. Never replace it:
            // the right key may still be written down somewhere.
            Err(_) => Ok((
                Connection::open_in_memory()?,
                Opened {
                    protection: Protection::Locked,
                    key: None,
                    detail: "the key in this system's keychain does not open the notes".to_owned(),
                },
            )),
        },

        // A key, and a plaintext database: carry it across, once.
        Stored::Key(key) => {
            if exists && plaintext {
                encrypt_file(path, &key)?;
            }
            Ok((
                open_encrypted(path, &key)?,
                Opened {
                    protection: Protection::On,
                    key: Some(key),
                    detail: String::new(),
                },
            ))
        }

        // No key yet: a fresh install, or a database from before encryption.
        Stored::Empty => {
            if exists && !plaintext {
                return Ok((
                    Connection::open_in_memory()?,
                    Opened {
                        protection: Protection::Locked,
                        key: None,
                        detail: "the notes are encrypted and this system's keychain has no key \
                                 for them"
                            .to_owned(),
                    },
                ));
            }
            let key = DatabaseKey::generate()?;
            // Stored *before* anything is encrypted with it: a key that could
            // not be kept is a database that could not be opened again.
            if let Err(reason) = write_key(&key) {
                log::error!("vault: the key could not be stored, so nothing was encrypted");
                return Ok((Connection::open(path)?, unavailable(reason)));
            }
            if exists && plaintext {
                encrypt_file(path, &key)?;
            }
            Ok((
                open_encrypted(path, &key)?,
                Opened {
                    protection: Protection::On,
                    key: Some(key),
                    detail: String::new(),
                },
            ))
        }

        // Nowhere to keep a key. Plaintext, and say so — an app that cannot
        // protect the notes should not pretend it has.
        Stored::NoStore(reason) => {
            if exists && !plaintext {
                return Ok((
                    Connection::open_in_memory()?,
                    Opened {
                        protection: Protection::Locked,
                        key: None,
                        detail: format!("the notes are encrypted, and {reason}"),
                    },
                ));
            }
            Ok((Connection::open(path)?, unavailable(reason)))
        }
    }
}

fn unavailable(reason: String) -> Opened {
    Opened {
        protection: Protection::Unavailable,
        key: None,
        detail: reason,
    }
}

fn open_encrypted(path: &Path, key: &DatabaseKey) -> AppResult<Connection> {
    let connection = Connection::open(path)?;
    key.apply(&connection)?;
    Ok(connection)
}

/// Turn a plaintext database into an encrypted one, in place.
///
/// The old file is moved aside first and removed only once the new one has been
/// opened, read and found to hold the same number of notes. If anything fails
/// the plaintext file is put back: a migration that goes wrong must cost
/// nothing. WAL means there are three files, and the two side files belong to
/// the old database — they are removed with it.
pub fn encrypt_file(path: &Path, key: &DatabaseKey) -> AppResult<()> {
    let backup = backup_path(path);
    let scratch = path.with_extension("db.encrypting");
    let _ = std::fs::remove_file(&scratch);

    let counts = {
        let plain = Connection::open(path)?;
        // `sqlcipher_export` reads through the live connection, so anything
        // still in the write-ahead log comes across with the rest.
        plain.execute_batch(&format!(
            "ATTACH DATABASE '{}' AS encrypted KEY \"{}\";
             SELECT sqlcipher_export('encrypted');
             DETACH DATABASE encrypted;",
            scratch.display(),
            key.pragma(),
        ))?;
        let version: i64 = plain.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let rows = row_count(&plain)?;
        (version, rows)
    };

    {
        let encrypted = open_encrypted(&scratch, key)?;
        // `sqlcipher_export` copies the schema and the rows and **not**
        // `user_version`, which is where the migration number lives. Left at 0,
        // every migration would run again on a database that already has them.
        encrypted.pragma_update(None, "user_version", counts.0)?;
        if row_count(&encrypted)? != counts.1 {
            let _ = std::fs::remove_file(&scratch);
            return Err(AppError::Locked(
                "the encrypted copy of the notes came out incomplete".to_owned(),
            ));
        }
    }

    std::fs::rename(path, &backup)?;
    if let Err(error) = std::fs::rename(&scratch, path) {
        // Put it back exactly as it was.
        let _ = std::fs::rename(&backup, path);
        return Err(error.into());
    }

    // It opens, it is complete: the plaintext copy is the thing this was meant
    // to get rid of, so it goes. The WAL files beside it belong to it too.
    let _ = std::fs::remove_file(&backup);
    let _ = std::fs::remove_file(backup.with_extension("backup-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
    log::info!("vault: the notes are encrypted from now on");
    Ok(())
}

/// Notes and tasks together: enough to catch a copy that lost rows, in a
/// database that may predate either table.
fn row_count(connection: &Connection) -> AppResult<i64> {
    let count = |table: &str| -> i64 {
        connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
    };
    Ok(count("notes") + count("tasks"))
}

/// Open a locked database with a key someone kept, and file that key where it
/// should have been. The database is not touched if the key does not open it.
pub fn unlock(path: &Path, key: &DatabaseKey) -> AppResult<Connection> {
    let connection = open_encrypted(path, key)?;
    if let Err(reason) = write_key(key) {
        // Worth continuing: the notes open now, which is what was asked for.
        log::error!("vault: unlocked, but the key could not be stored: {reason}");
    }
    Ok(connection)
}

/// Give up on a database nobody has the key for, and start again.
///
/// The old file is renamed, never deleted: a key found next week should still
/// have something to open. Returns where it was put.
pub fn set_aside(path: &Path) -> AppResult<(PathBuf, Connection, Opened)> {
    let aside = locked_aside_path(path);
    std::fs::rename(path, &aside)?;
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));

    let key = DatabaseKey::generate()?;
    if let Err(reason) = write_key(&key) {
        return Ok((aside, Connection::open(path)?, unavailable(reason)));
    }
    Ok((
        aside,
        open_encrypted(path, &key)?,
        Opened {
            protection: Protection::On,
            key: Some(key),
            detail: String::new(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ledge-vault-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_generated_key_is_thirty_two_bytes_of_hex() {
        let key = DatabaseKey::generate().expect("generate");
        assert_eq!(key.0.len(), 64);
        assert!(key.0.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(key, DatabaseKey::generate().expect("generate"));
    }

    #[test]
    fn a_recovery_key_reads_back_as_the_key_it_came_from() {
        let key = DatabaseKey::generate().expect("generate");
        let written = key.recovery_key();
        assert_eq!(written.len(), 64 + 7);
        assert_eq!(DatabaseKey::parse(&written), Some(key.clone()));
        // However it is typed back in: spaces, lower case, or the groups run in.
        assert_eq!(DatabaseKey::parse(&written.replace('-', " ")), Some(key));
    }

    #[test]
    fn anything_that_is_not_a_key_is_refused() {
        assert_eq!(DatabaseKey::parse(""), None);
        assert_eq!(DatabaseKey::parse("hello"), None);
        assert_eq!(DatabaseKey::parse(&"a".repeat(63)), None);
        assert_eq!(DatabaseKey::parse(&"a".repeat(65)), None);
    }

    #[test]
    fn an_encrypted_database_is_not_readable_without_the_key() {
        let dir = temp_dir();
        let path = dir.join("notes.db");
        let key = DatabaseKey::generate().expect("generate");
        {
            let connection = Connection::open(&path).expect("open");
            key.apply(&connection).expect("key");
            connection
                .execute_batch(
                    "CREATE TABLE notes (id TEXT, content TEXT);
                                INSERT INTO notes VALUES ('a', 'the password is hunter2');",
                )
                .expect("write");
        }

        let bytes = std::fs::read(&path).expect("read");
        assert!(!bytes.starts_with(SQLITE_HEADER));
        assert!(
            !bytes
                .windows(8)
                .any(|window| window == b"hunter2\0" || window == b"hunter2 "),
            "the note's text is on disk in the clear"
        );

        let wrong = Connection::open(&path).expect("open");
        assert!(
            DatabaseKey::generate()
                .expect("generate")
                .apply(&wrong)
                .is_err(),
            "another key opened the database"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn encrypting_an_existing_database_keeps_its_rows_and_its_migration_number() {
        let dir = temp_dir();
        let path = dir.join("notes.db");
        {
            let plain = Connection::open(&path).expect("open");
            plain
                .execute_batch(
                    "PRAGMA journal_mode=WAL;
                     PRAGMA user_version=4;
                     CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT);
                     CREATE TABLE tasks (id TEXT PRIMARY KEY);
                     INSERT INTO notes VALUES ('a', 'kept'), ('b', 'also kept');
                     INSERT INTO tasks VALUES ('t');",
                )
                .expect("write");
        }

        let key = DatabaseKey::generate().expect("generate");
        encrypt_file(&path, &key).expect("encrypt");

        assert!(!is_plaintext(&path), "still a plain database afterwards");
        assert!(
            !backup_path(&path).exists(),
            "the plaintext copy was left behind"
        );

        let opened = open_encrypted(&path, &key).expect("reopen");
        let version: i64 = opened
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 4, "the migration number did not come across");
        assert_eq!(row_count(&opened).expect("rows"), 3);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_database_whose_key_is_wrong_is_never_replaced() {
        let dir = temp_dir();
        let path = dir.join("notes.db");
        let key = DatabaseKey::generate().expect("generate");
        {
            let connection = open_encrypted(&path, &key).expect("open");
            connection
                .execute_batch("CREATE TABLE notes (id TEXT); INSERT INTO notes VALUES ('a');")
                .expect("write");
        }
        let before = std::fs::read(&path).expect("read");

        let other = DatabaseKey::generate().expect("generate");
        assert!(unlock(&path, &other).is_err());
        assert_eq!(std::fs::read(&path).expect("read"), before);

        std::fs::remove_dir_all(&dir).ok();
    }
}
