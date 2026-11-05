use anlg_apple_todo::types::{
    CreateReminderInput, Reminder, ReminderFilter, ReminderIdentifierInput, ReminderList,
};

use crate::error::Error;
use crate::read_path::{ReadPath, ReadPathResult};

#[tauri::command]
#[specta::specta]
pub fn authorization_status() -> Result<String, Error> {
    #[cfg(target_os = "macos")]
    {
        let status = anlg_apple_todo::Handle::authorization_status();
        Ok(format!("{:?}", status))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn request_full_access() -> Result<bool, Error> {
    #[cfg(target_os = "macos")]
    {
        Ok(anlg_apple_todo::Handle::request_full_access())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_todo_lists() -> Result<Vec<ReminderList>, Error> {
    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        handle.list_reminder_lists().map_err(Into::into)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn fetch_todos(filter: ReminderFilter) -> Result<Vec<Reminder>, Error> {
    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        handle.fetch_reminders(filter).map_err(Into::into)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = filter;
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn read_path(path: String) -> Result<ReadPathResult, Error> {
    let ReadPath::Apple(path) = ReadPath::parse(&path)?;

    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        match handle.read_path(path)? {
            anlg_apple_todo::ReadPathResult::Lists(items) => {
                Ok(ReadPathResult::ReminderLists(items))
            }
            anlg_apple_todo::ReadPathResult::Reminders(items) => {
                Ok(ReadPathResult::Reminders(items))
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn create_todo(input: CreateReminderInput) -> Result<String, Error> {
    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        handle.create_reminder_identifier(input).map_err(Into::into)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = input;
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn complete_todo(target: ReminderIdentifierInput) -> Result<(), Error> {
    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        handle.complete_reminder(&target).map_err(Into::into)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err(Error::UnsupportedPlatform)
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_todo(target: ReminderIdentifierInput) -> Result<(), Error> {
    #[cfg(target_os = "macos")]
    {
        let handle = anlg_apple_todo::Handle;
        handle.delete_reminder(&target).map_err(Into::into)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err(Error::UnsupportedPlatform)
    }
}
