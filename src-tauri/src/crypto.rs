use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use std::fs;
use std::path::Path;

const KEY_FILENAME: &str = ".key";

fn key_path() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot determine HOME")?;
    Ok(format!("{}/.agent-founder/{}", home, KEY_FILENAME))
}

fn get_or_create_key() -> Result<[u8; 32], String> {
    let path = key_path()?;
    if Path::new(&path).exists() {
        let bytes = fs::read(&path).map_err(|e| format!("Failed to read key: {e}"))?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create key dir: {e}"))?;
    }
    fs::write(&path, &key).map_err(|e| format!("Failed to write key: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms).map_err(|e| format!("Failed to set key perms: {e}"))?;
    }

    Ok(key)
}

pub fn encrypt(plaintext: &str) -> Result<String, String> {
    let key_bytes = get_or_create_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("Cipher init error: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encrypt error: {e}"))?;

    // nonce (12 bytes) + ciphertext, all base64 encoded
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

pub fn decrypt(encoded: &str) -> Result<String, String> {
    let key_bytes = get_or_create_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("Cipher init error: {e}"))?;

    let combined = B64
        .decode(encoded)
        .map_err(|e| format!("Base64 decode error: {e}"))?;

    if combined.len() < 13 {
        return Err("Ciphertext too short".into());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — key may have changed".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 error: {e}"))
}

/// Returns true if the value looks like it was encrypted (base64 with correct structure)
pub fn is_encrypted(value: &str) -> bool {
    B64.decode(value)
        .map(|bytes| bytes.len() >= 13)
        .unwrap_or(false)
}
