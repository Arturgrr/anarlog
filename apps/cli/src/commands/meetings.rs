use crate::cli::{DocumentKind, ExportFormat, MeetingCommand};
use crate::{Error, Result, output};
use anlg_agent_access::{
    Document, Folder, GetMeetingInput, GetMeetingTranscriptInput, GetRecurringMeetingHistoryInput,
    ListFoldersInput, ListMeetingsInput, MeetingListItem,
};
use anlg_db_core::Db;

pub async fn run(db: &Db, command: MeetingCommand, json: bool) -> Result<()> {
    let pool = db.pool();
    match command {
        MeetingCommand::Import { .. } | MeetingCommand::ImportStatus { .. } => {
            unreachable!("handled before opening read-only source")
        }
        MeetingCommand::PilotUsage { from_ms, until_ms } => {
            require_json(json, "meetings pilot-usage")?;
            super::meeting_pilot::run(db, from_ms, until_ms).await
        }
        MeetingCommand::HoldList {
            after,
            limit,
            database_only,
        } => {
            require_json(json, "meetings hold-list")?;
            super::meeting_hold::list(db, &after, limit, database_only).await
        }
        MeetingCommand::HoldExport { id, database_only } => {
            require_json(json, "meetings hold-export")?;
            super::meeting_hold::export(db, &id, database_only).await
        }
        MeetingCommand::Delete { .. }
        | MeetingCommand::Capabilities
        | MeetingCommand::InitializeManaged => {
            unreachable!("handled before opening a data source")
        }
        MeetingCommand::List {
            query,
            series_id,
            folder,
            limit,
            offset,
        } => {
            let page = anlg_agent_access::list_meetings(
                pool,
                ListMeetingsInput {
                    query,
                    series_id,
                    folder_path: folder,
                    limit: Some(limit),
                    offset: Some(offset),
                },
            )
            .await?;
            let rendered = if json {
                output::json("meetings.list", &page.meetings, Some(&page.pagination))?
            } else {
                render_list(&page.meetings)
            };
            output::emit(&rendered);
            Ok(())
        }
        MeetingCommand::Folders {
            query,
            limit,
            offset,
        } => {
            let page = anlg_agent_access::list_folders(
                pool,
                ListFoldersInput {
                    query,
                    limit: Some(limit),
                    offset: Some(offset),
                },
            )
            .await?;
            let rendered = if json {
                output::json("meetings.folders", &page.folders, Some(&page.pagination))?
            } else {
                render_folders(&page.folders)
            };
            output::emit(&rendered);
            Ok(())
        }
        MeetingCommand::Get { id } => {
            let meeting =
                anlg_agent_access::get_meeting(pool, GetMeetingInput { meeting_id: id }).await?;
            let rendered = if json {
                output::json(
                    "meetings.get",
                    &anlg_agent_access::local_meeting(pool, meeting).await?,
                    None,
                )?
            } else {
                meeting.to_markdown()
            };
            output::emit(&rendered);
            Ok(())
        }
        MeetingCommand::Note { id, kind } => {
            let meeting = anlg_agent_access::get_meeting(
                pool,
                GetMeetingInput {
                    meeting_id: id.clone(),
                },
            )
            .await?;
            if json {
                match kind {
                    DocumentKind::Note => {
                        output::emit(&output::json("meetings.note", &meeting.note, None)?)
                    }
                    DocumentKind::Summary => {
                        output::emit(&output::json("meetings.note", &meeting.summaries, None)?)
                    }
                    DocumentKind::All => output::emit(&output::json(
                        "meetings.note",
                        &serde_json::json!({
                            "note": meeting.note,
                            "summaries": meeting.summaries,
                        }),
                        None,
                    )?),
                }
                return Ok(());
            }

            let text = match kind {
                DocumentKind::Note => meeting
                    .note
                    .map(|note| note.markdown)
                    .ok_or_else(|| crate::Error::NotFound(format!("note for meeting '{id}'")))?,
                DocumentKind::Summary => render_documents(&meeting.summaries),
                DocumentKind::All => {
                    let mut documents = meeting.note.into_iter().collect::<Vec<_>>();
                    documents.extend(meeting.summaries);
                    render_documents(&documents)
                }
            };
            output::emit(&text);
            Ok(())
        }
        MeetingCommand::Transcript { id, limit, offset } => {
            let page = anlg_agent_access::get_meeting_transcript(
                pool,
                GetMeetingTranscriptInput {
                    meeting_id: id,
                    offset: Some(offset),
                    limit: Some(limit),
                },
            )
            .await?;
            let rendered = if json {
                let content = serde_json::json!({
                    "meeting_id": &page.meeting_id,
                    "text": &page.text,
                    "words": &page.words,
                });
                output::json("meetings.transcript", &content, Some(&page.pagination))?
            } else {
                page.text
            };
            output::emit(&rendered);
            Ok(())
        }
        MeetingCommand::History { id, limit, offset } => {
            let page = anlg_agent_access::get_recurring_meeting_history(
                pool,
                GetRecurringMeetingHistoryInput {
                    meeting_id: id,
                    limit: Some(limit),
                    offset: Some(offset),
                },
            )
            .await?;
            let rendered = if json {
                output::json("meetings.history", &page.meetings, Some(&page.pagination))?
            } else {
                render_list(&page.meetings)
            };
            output::emit(&rendered);
            Ok(())
        }
        MeetingCommand::Export {
            id,
            format,
            output: path,
            force,
        } => {
            if matches!(format, ExportFormat::Json) {
                let meeting = anlg_agent_access::get_local_meeting_export(pool, id).await?;
                let content = if json {
                    output::json("meetings.export", &meeting, None)?
                } else {
                    output::raw_json(&meeting)?
                };
                return output::write_or_emit(&content, path.as_deref(), force);
            }
            let meeting = anlg_agent_access::get_meeting_export(pool, id).await?;
            let content = match (format, json) {
                (ExportFormat::Markdown, false) => meeting.to_markdown(),
                (ExportFormat::Json, false) => output::raw_json(&meeting)?,
                (ExportFormat::Markdown, true) => output::json(
                    "meetings.export",
                    &serde_json::json!({
                        "format": "markdown",
                        "content": meeting.to_markdown(),
                    }),
                    None,
                )?,
                (ExportFormat::Json, true) => output::json("meetings.export", &meeting, None)?,
            };
            output::write_or_emit(&content, path.as_deref(), force)
        }
    }
}

fn render_list(meetings: &[MeetingListItem]) -> String {
    if meetings.is_empty() {
        return "No meetings found.".to_string();
    }

    let title_width = meetings
        .iter()
        .map(|meeting| meeting.title.chars().count())
        .max()
        .unwrap_or(0)
        .clamp(5, 48);
    let folder_width = meetings
        .iter()
        .filter_map(|meeting| meeting.folder_path.as_deref())
        .map(|path| path.chars().count())
        .max()
        .map(|width| width.clamp(6, 32));
    let folder_column = |value: &str| {
        folder_width
            .map(|width| format!("{:<width$}  ", truncate(value, width)))
            .unwrap_or_default()
    };
    let mut lines = vec![format!(
        "{:<24}  {:<title_width$}  {}ID",
        "DATE",
        "TITLE",
        folder_column("FOLDER")
    )];
    for meeting in meetings {
        let occurred_at = if meeting.started_at.is_empty() {
            &meeting.created_at
        } else {
            &meeting.started_at
        };
        lines.push(format!(
            "{:<24}  {:<title_width$}  {}{}",
            truncate(occurred_at, 24),
            truncate(
                if meeting.title.is_empty() {
                    "Untitled"
                } else {
                    &meeting.title
                },
                title_width,
            ),
            folder_column(meeting.folder_path.as_deref().unwrap_or_default()),
            meeting.id,
        ));
    }
    lines.join("\n")
}

fn render_folders(folders: &[Folder]) -> String {
    if folders.is_empty() {
        return "No folders found.".to_string();
    }
    folders
        .iter()
        .map(|folder| folder.path.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn require_json(json: bool, feature: &str) -> Result<()> {
    if json {
        Ok(())
    } else {
        Err(Error::InvalidRequest(format!("{feature} requires --json")))
    }
}

fn render_documents(documents: &[Document]) -> String {
    documents
        .iter()
        .filter(|document| !document.markdown.trim().is_empty())
        .map(|document| {
            let title = if document.title.trim().is_empty() {
                "Summary"
            } else {
                document.title.trim()
            };
            format!("## {title}\n\n{}", document.markdown.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn truncate(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        return value.to_string();
    }
    let mut text = value
        .chars()
        .take(width.saturating_sub(1))
        .collect::<String>();
    text.push('…');
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_render_is_bounded_and_contains_ids() {
        let rendered = render_list(&[MeetingListItem {
            id: "meeting-1".to_string(),
            title: "A very long planning meeting title that should not own the terminal"
                .to_string(),
            kind: "meeting".to_string(),
            status: "active".to_string(),
            created_at: "2026-07-13T09:00:00Z".to_string(),
            updated_at: "2026-07-13T09:00:00Z".to_string(),
            started_at: String::new(),
            ended_at: String::new(),
            series_id: String::new(),
            folder_path: None,
        }]);
        assert!(rendered.contains("meeting-1"));
        assert!(rendered.contains('…'));
        assert!(!rendered.contains("FOLDER"));
    }

    #[test]
    fn list_render_shows_folders_when_present() {
        let meeting = |id: &str, folder_path: Option<&str>| MeetingListItem {
            id: id.to_string(),
            title: "Planning".to_string(),
            kind: "meeting".to_string(),
            status: "active".to_string(),
            created_at: "2026-07-13T09:00:00Z".to_string(),
            updated_at: "2026-07-13T09:00:00Z".to_string(),
            started_at: String::new(),
            ended_at: String::new(),
            series_id: String::new(),
            folder_path: folder_path.map(str::to_string),
        };
        let rendered = render_list(&[
            meeting("meeting-1", Some("Clients/ACME")),
            meeting("meeting-2", None),
        ]);
        let lines = rendered.lines().collect::<Vec<_>>();
        assert!(lines[0].contains("FOLDER"));
        assert!(lines[1].contains("Clients/ACME  meeting-1"));
        assert!(lines[2].ends_with("meeting-2"));
    }
}
