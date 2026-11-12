//! Classification d'âge : normalise les systèmes de notation courants en un âge minimal,
//! et repère les chaînes/groupes explicitement destinés aux adultes.

/// Convertit une notation (« -12 », « PEGI 16 », « FSK 18 », « TV-MA », « PG-13 », « 16+ »…) en âge minimal.
pub fn age_from_rating(raw: &str) -> Option<u8> {
    let r = raw.trim().to_uppercase();
    let named = match r.as_str() {
        "TV-Y" | "G" | "U" | "TP" | "TOUS PUBLICS" | "ALL" | "AL" => Some(0),
        "TV-Y7" | "TV-Y7-FV" => Some(7),
        "TV-G" => Some(0),
        "TV-PG" | "PG" => Some(10),
        "TV-14" => Some(14),
        "PG-13" => Some(13),
        "R" => Some(17),
        "TV-MA" | "NC-17" | "X" | "XXX" | "ADULT" => Some(18),
        "12A" => Some(12),
        _ => None,
    };
    if named.is_some() {
        return named;
    }
    // Premier nombre plausible dans la chaîne (« -12 », « PEGI 16 », « FSK16 », « 18+ »).
    let digits: String = r.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u8>().ok().filter(|a| *a <= 21)
}

const ADULT_HINTS: &[&str] = &["xxx", "adult", "adulte", "18+", "+18", "porn", "erotic", "érotique", "hot ", "playboy", "hustler", "brazzers", "private tv", "dorcel"];

/// Vrai si le nom ou le groupe indique un contenu réservé aux adultes.
pub fn is_adult(name: &str, group: Option<&str>) -> bool {
    let hay = format!(" {} | {} ", name.to_lowercase(), group.unwrap_or("").to_lowercase());
    ADULT_HINTS.iter().any(|h| hay.contains(h))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ratings() {
        assert_eq!(age_from_rating("-12"), Some(12));
        assert_eq!(age_from_rating("PEGI 16"), Some(16));
        assert_eq!(age_from_rating("FSK18"), Some(18));
        assert_eq!(age_from_rating("TV-MA"), Some(18));
        assert_eq!(age_from_rating("PG-13"), Some(13));
        assert_eq!(age_from_rating("Tous publics"), Some(0));
        assert_eq!(age_from_rating("inconnu"), None);
        assert!(is_adult("Chaîne XXX", None));
        assert!(is_adult("Film", Some("Adult 18+")));
        assert!(!is_adult("France 2", Some("Généraliste")));
    }
}
