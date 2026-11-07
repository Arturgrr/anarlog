const MAX_MENU_BAR_LABEL_WIDTH: usize = 30;

use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

pub fn menu_bar_title(is_recording: bool, recording_title: Option<&str>) -> Option<String> {
    if !is_recording {
        return None;
    }

    let title = recording_title?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        return None;
    }

    Some(compact_title(&title, MAX_MENU_BAR_LABEL_WIDTH))
}

fn compact_title(title: &str, max_width: usize) -> String {
    if title.width() <= max_width {
        return title.to_string();
    }

    let mut compact = String::new();
    let mut width = 0;
    for character in title.chars() {
        let character_width = character.width().unwrap_or(0);
        if width + character_width >= max_width {
            break;
        }
        compact.push(character);
        width += character_width;
    }

    format!("{compact}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_the_recording_title_only_while_recording() {
        assert_eq!(
            menu_bar_title(true, Some("  Customer   call ")),
            Some("Customer call".to_string())
        );
        assert_eq!(menu_bar_title(false, Some("Customer call")), None);
        assert_eq!(menu_bar_title(true, None), None);
        assert_eq!(menu_bar_title(true, Some("  ")), None);

        assert_eq!(
            menu_bar_title(true, Some("Sprint retrospective and planning session")),
            Some("Sprint retrospective and plan…".to_string())
        );
    }
}
