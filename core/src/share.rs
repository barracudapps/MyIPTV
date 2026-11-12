//! Partage de configuration entre appareils du réseau local.
//!
//! L'émetteur affiche un code court ; le récepteur le saisit. Le code ne circule
//! jamais : il sert à dériver l'identifiant demandé au serveur et la clé AES-256-GCM
//! qui chiffre la configuration (identifiants de comptes compris).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use sha2::{Digest, Sha256};

/// Alphabet sans caractères ambigus (0/O, 1/I/L), facile à saisir à la télécommande.
pub const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
pub const CODE_LEN: usize = 8;
const ROUNDS: u32 = 100_000;

/// Code saisi par l'utilisateur, débarrassé des tirets, espaces et minuscules.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

/// Code lisible (« ABCD-EFGH ») à partir d'octets aléatoires.
pub fn code_from_random(random: &[u8]) -> String {
    let raw: String = random.iter().take(CODE_LEN).map(|b| CODE_ALPHABET[*b as usize % CODE_ALPHABET.len()] as char).collect();
    format!("{}-{}", &raw[..4], &raw[4..])
}

fn stretch(label: &str, code: &str) -> [u8; 32] {
    let mut h: [u8; 32] = Sha256::digest(format!("myiptv-share-{label}:{}", normalize_code(code))).into();
    for _ in 0..ROUNDS {
        h = Sha256::digest(h).into();
    }
    h
}

/// Identifiant public du partage (chemin HTTP), qui ne permet pas de retrouver la clé.
pub fn share_id(code: &str) -> String {
    let h: [u8; 32] = Sha256::digest(format!("myiptv-share-id:{}", normalize_code(code))).into();
    h[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// Chiffre `plain` ; le résultat commence par le nonce (12 octets).
pub fn seal(code: &str, plain: &[u8], nonce: [u8; 12]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(&stretch("key", code).into());
    let mut out = nonce.to_vec();
    out.extend(cipher.encrypt(Nonce::from_slice(&nonce), plain).expect("chiffrement AES-GCM"));
    out
}

pub fn open(code: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 + 16 {
        return Err("partage illisible".into());
    }
    let cipher = Aes256Gcm::new(&stretch("key", code).into());
    cipher.decrypt(Nonce::from_slice(&data[..12]), &data[12..]).map_err(|_| "code incorrect".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_code() {
        let sealed = seal("ab cd-efgh", b"{\"a\":1}", [7; 12]);
        assert_eq!(open("ABCD-EFGH", &sealed).unwrap(), b"{\"a\":1}");
        assert!(open("ABCD-EFGJ", &sealed).is_err());
        assert_eq!(share_id("abcd efgh"), share_id("ABCD-EFGH"));
        assert_ne!(share_id("ABCD-EFGH"), share_id("ABCD-EFGJ"));
    }

    #[test]
    fn code_shape() {
        let c = code_from_random(&[0, 1, 2, 3, 4, 5, 6, 30]);
        assert_eq!(c, "2345-678Z");
        assert_eq!(normalize_code("o1l-x"), "011X");
    }
}
