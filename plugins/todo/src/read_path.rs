use anlg_apple_todo::types::{Reminder, ReminderList};

use crate::error::Error;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ReadPathResult {
    ReminderLists(Vec<ReminderList>),
    Reminders(Vec<Reminder>),
}

pub enum ReadPath<'a> {
    Apple(&'a str),
}

impl<'a> ReadPath<'a> {
    pub fn parse(path: &'a str) -> Result<Self, Error> {
        let trimmed = path.trim_matches('/');
        let segments = trimmed
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();

        match segments.as_slice() {
            ["apple"] => Ok(Self::Apple("")),
            ["apple", ..] => Ok(Self::Apple(&trimmed["apple/".len()..])),
            _ => Err(Error::InvalidReadPath(path.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ReadPath;

    #[test]
    fn parses_apple_paths() {
        assert!(matches!(ReadPath::parse("apple"), Ok(ReadPath::Apple(""))));
        assert!(matches!(
            ReadPath::parse("/apple/list-1/reminders/"),
            Ok(ReadPath::Apple("list-1/reminders"))
        ));
    }

    #[test]
    fn rejects_unknown_paths() {
        assert!(ReadPath::parse("linear/conn-1/teams").is_err());
        assert!(ReadPath::parse("github/conn-1/repos/openai/char").is_err());
    }
}
