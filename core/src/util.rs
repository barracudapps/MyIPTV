/// Clé courte et déterministe (FNV-1a 64 bits) — identique en natif et en WASM.
pub fn stable_key(parts: &[&str]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.as_bytes().iter().chain(std::iter::once(&0u8)) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

/// Normalise un nom de chaîne pour la correspondance avec le guide :
/// minuscules, sans accents courants, sans suffixes de qualité ni ponctuation.
pub fn normalize_name(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_paren = 0u32;
    for c in lower.chars() {
        match c {
            '(' | '[' => in_paren += 1,
            ')' | ']' => in_paren = in_paren.saturating_sub(1),
            _ if in_paren > 0 => {}
            'à' | 'á' | 'â' | 'ä' | 'ã' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'î' | 'ï' | 'í' => out.push('i'),
            'ô' | 'ö' | 'ó' | 'õ' => out.push('o'),
            'ù' | 'û' | 'ü' | 'ú' => out.push('u'),
            'ç' => out.push('c'),
            c if c.is_alphanumeric() => out.push(c),
            _ => out.push(' '),
        }
    }
    out.split_whitespace()
        .filter(|w| !matches!(*w, "hd" | "fhd" | "uhd" | "sd" | "4k" | "hevc" | "h265" | "1080p" | "720p" | "480p" | "576p" | "2160p" | "backup"))
        .collect::<Vec<_>>()
        .join("")
}

/// Décompresse si les octets sont au format gzip, sinon renvoie tels quels.
pub fn maybe_gunzip(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    if bytes.len() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        use std::io::Read;
        let mut out = Vec::with_capacity(bytes.len() * 8);
        flate2::read::MultiGzDecoder::new(bytes).read_to_end(&mut out)?;
        Ok(out)
    } else {
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes() {
        assert_eq!(normalize_name("France 2 HD (1080p) [Geo-blocked]"), "france2");
        assert_eq!(normalize_name("Télé-Québec"), "telequebec");
        assert_eq!(normalize_name("TF1 FHD"), "tf1");
    }
}
