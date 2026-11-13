use std::sync::Arc;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::*;
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt, service::RequestContext, tool,
    tool_handler, tool_router,
};
use serde::Serialize;

use crate::{Error, annotations};
use anlg_agent_access as access;

#[derive(Clone)]
struct LibrelogMcpServer {
    db: Arc<anlg_db_core::Db>,
    /// The desktop app's annotations folder.
    annotations: std::path::PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
enum ResourceRequest {
    Meeting {
        meeting_id: String,
    },
    Transcript {
        meeting_id: String,
        offset: u32,
        limit: u32,
    },
    Series {
        series_id: String,
    },
}

impl LibrelogMcpServer {
    #[cfg(test)]
    fn new(db: Arc<anlg_db_core::Db>) -> Self {
        Self::with_annotations(db, std::path::PathBuf::from("annotations"))
    }

    fn with_annotations(db: Arc<anlg_db_core::Db>, annotations: std::path::PathBuf) -> Self {
        Self { db, annotations }
    }
}

#[tool_router]
impl LibrelogMcpServer {
    #[tool(
        title = "List annotations",
        description = "List the screen annotations recorded with Librelog's Annotate shortcut (screen recording, red ink and narration), newest first, with id, created time, duration, the app and window in front, and the folder. Pass an id to get_annotation.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<annotations::AnnotationList>(),
        annotations(read_only_hint = true, destructive_hint = false, idempotent_hint = true, open_world_hint = false)
    )]
    async fn list_annotations(
        &self,
        Parameters(input): Parameters<annotations::ListAnnotationsInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let root = self.annotations.clone();
        let list = tokio::task::spawn_blocking(move || annotations::list(&root, input.limit))
            .await
            .map_err(internal_error)?;
        structured(&list)
    }

    #[tool(
        title = "Get annotation",
        description = "Get one screen annotation, the newest when id is omitted: its summary (what was said and marked on each numbered key frame), the transcript, the contact sheet as an image, the key frame paths, and the video and audio paths while retention keeps them. Read the summary beside the image.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<annotations::AnnotationDetail>(),
        annotations(read_only_hint = true, destructive_hint = false, idempotent_hint = true, open_world_hint = false)
    )]
    async fn get_annotation(
        &self,
        Parameters(input): Parameters<annotations::GetAnnotationInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let root = self.annotations.clone();
        let (detail, sheet) =
            tokio::task::spawn_blocking(move || annotations::get(&root, input.id.as_deref()))
                .await
                .map_err(internal_error)?
                .map_err(|error| match error {
                    annotations::Error::Read(_) => internal_error(error),
                    _ => McpError::invalid_params(error.to_string(), None),
                })?;
        let mut result = structured(&detail)?;
        result.content.push(ContentBlock::image(
            annotations::base64_png(&sheet),
            "image/png",
        ));
        Ok(result)
    }

    #[tool(
        title = "Import recording",
        description = "Create a meeting from a local audio file using the running Librelog desktop app and its configured providers. May send audio to the configured transcription provider and use paid quota. file_path is on this computer, not a remote host. Returns durable job and meeting IDs. Reuse request_key on retries; poll get_recording_import until done or failed.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::RecordingImport>(),
        annotations(read_only_hint = false, destructive_hint = false, idempotent_hint = false, open_world_hint = true)
    )]
    async fn import_recording(
        &self,
        Parameters(input): Parameters<access::ImportRecordingInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        structured(
            &access::import_recording(self.db.pool(), input)
                .await
                .map_err(command_error)?,
        )
    }

    #[tool(
        title = "Get recording import",
        description = "Get durable recording import processing_status, summary_status and error. A failed summary preserves the meeting and transcript. queued requires the desktop app to run.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::RecordingImport>(),
        annotations(read_only_hint = true, destructive_hint = false, idempotent_hint = true, open_world_hint = false)
    )]
    async fn get_recording_import(
        &self,
        Parameters(input): Parameters<access::GetRecordingImportInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        structured(
            &access::get_recording_import(self.db.pool(), &input.job_id)
                .await
                .map_err(command_error)?,
        )
    }

    #[tool(
        title = "List meetings",
        description = "List recent Librelog meetings with pagination metadata. Use query to narrow by title or meeting id and folder_path to scope to a folder and its subfolders, then pass next_offset as offset to continue.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::MeetingPage>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_meetings(
        &self,
        Parameters(input): Parameters<access::ListMeetingsInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let page = access::list_meetings(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&page)
    }

    #[tool(
        title = "List folders",
        description = "List Librelog meeting folders, including empty and parent folders, with pagination metadata. Pass a returned path as list_meetings folder_path. Query matches a case-insensitive path substring.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::FolderPage>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_folders(
        &self,
        Parameters(input): Parameters<access::ListFoldersInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let page = access::list_folders(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&page)
    }

    #[tool(
        title = "Get meeting",
        description = "Get one Librelog meeting with its canonical note, summaries, participants, and action items. Use get_meeting_transcript separately for transcript words.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::LocalMeeting>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_meeting(
        &self,
        Parameters(input): Parameters<access::GetMeetingInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let meeting = access::get_meeting(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        let meeting = access::local_meeting(self.db.pool(), meeting)
            .await
            .map_err(command_error)?;
        structured(&meeting)
    }

    #[tool(
        title = "Get meeting transcript",
        description = "Get a bounded page of transcript words and readable text for an Librelog meeting. Pass pagination.next_offset as offset to continue.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::TranscriptPage>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_meeting_transcript(
        &self,
        Parameters(input): Parameters<access::GetMeetingTranscriptInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let page = access::get_meeting_transcript(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&page)
    }

    #[tool(
        title = "Get recurring meeting history",
        description = "List meetings in the same recurring series as the supplied meeting, newest first, with pagination metadata.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::MeetingPage>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_recurring_meeting_history(
        &self,
        Parameters(input): Parameters<access::GetRecurringMeetingHistoryInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let page = access::get_recurring_meeting_history(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&page)
    }

    #[tool(
        title = "Export meeting",
        description = "Get a complete Librelog meeting export with notes, summaries, participants, action items, and transcripts.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::MeetingExport>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn export_meeting(
        &self,
        Parameters(input): Parameters<access::GetMeetingInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let export = access::get_meeting_export(self.db.pool(), input.meeting_id)
            .await
            .map_err(command_error)?;
        structured(&export)
    }

    #[tool(
        title = "Propose summary edit",
        description = "Propose a complete summary replacement. The proposal stays pending until a human applies it in the Librelog desktop app. Specify target_id when the meeting has multiple summaries.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::Proposal>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn propose_summary_edit(
        &self,
        Parameters(input): Parameters<ProposeSummaryInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let proposal = access::create_proposal(
            self.db.pool(),
            access::CreateProposalInput {
                meeting_id: input.meeting_id,
                kind: "summary_replace".to_string(),
                target_id: input.target_id,
                content: input.content,
                source: Some("mcp".to_string()),
            },
        )
        .await
        .map_err(command_error)?;
        structured(&proposal)
    }

    #[tool(
        title = "Propose memo edit",
        description = "Propose a complete memo replacement. The proposal stays pending until a human applies it in the Librelog desktop app.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::Proposal>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn propose_memo_edit(
        &self,
        Parameters(input): Parameters<ProposeMemoInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let proposal = access::create_proposal(
            self.db.pool(),
            access::CreateProposalInput {
                meeting_id: input.meeting_id,
                kind: "memo_replace".to_string(),
                target_id: None,
                content: input.content,
                source: Some("mcp".to_string()),
            },
        )
        .await
        .map_err(command_error)?;
        structured(&proposal)
    }

    #[tool(
        title = "List proposals",
        description = "List staged Librelog meeting proposals. Defaults to pending proposals. Pass status all to include applied and declined rows, and next_offset as offset to continue.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::ProposalPage>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_proposals(
        &self,
        Parameters(input): Parameters<access::ListProposalsInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let page = access::list_proposals(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&page)
    }

    #[tool(
        title = "Get proposal",
        description = "Get one staged Librelog proposal, including its unified diff. The proposal is not applied.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::Proposal>(),
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_proposal(
        &self,
        Parameters(input): Parameters<access::GetProposalInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let proposal = access::get_proposal(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&proposal)
    }

    #[tool(
        title = "Decline proposal",
        description = "Decline a pending proposal without changing the meeting. Applied proposals cannot be declined.",
        output_schema = rmcp::handler::server::tool::schema_for_type::<access::Proposal>(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn decline_proposal(
        &self,
        Parameters(input): Parameters<access::DeclineProposalInput>,
    ) -> std::result::Result<CallToolResult, McpError> {
        let proposal = access::decline_proposal(self.db.pool(), input)
            .await
            .map_err(command_error)?;
        structured(&proposal)
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
struct ProposeSummaryInput {
    meeting_id: String,
    content: String,
    target_id: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
struct ProposeMemoInput {
    meeting_id: String,
    content: String,
}

#[tool_handler]
impl ServerHandler for LibrelogMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_protocol_version(ProtocolVersion::V_2026_07_28)
        .with_server_info(Implementation::new("librelog", crate::VERSION))
        .with_instructions(
            "Local access to Librelog meeting data. Start with list_meetings to resolve a meeting_id; to scope work to a project or client, call list_folders and pass a returned path as folder_path. Then call get_meeting for notes, summaries, participants, and action items. Request transcript pages with get_meeting_transcript and continue with pagination.next_offset; each page is capped at 500 words. Use get_recurring_meeting_history for series context. Use export_meeting only when the task needs the complete record including transcripts. To persist an edit, call propose_summary_edit or propose_memo_edit; the result stays pending until a human applies it in the desktop app. List or inspect staged work with list_proposals and get_proposal. decline_proposal discards a pending proposal without changing the meeting. Never invent meeting titles, dates, or ids. If list_meetings returns no meetings, say so. Never access SQLite directly, or claim a proposal was applied. For screen annotations the user recorded (screen, red ink, narration), call get_annotation, or list_annotations to choose one. Documentation: https://github.com/Arturgrr/librelog/blob/main/docs/reference/mcp.mdx",
        )
    }

    async fn list_resources(
        &self,
        params: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> std::result::Result<ListResourcesResult, McpError> {
        let offset = params
            .and_then(|params| params.cursor)
            .map(|cursor| {
                cursor.parse::<u32>().map_err(|_| {
                    McpError::invalid_params("resource cursor must be an integer", None)
                })
            })
            .transpose()?
            .unwrap_or(0);
        let page = access::list_meetings(
            self.db.pool(),
            access::ListMeetingsInput {
                query: None,
                series_id: None,
                folder_path: None,
                limit: Some(access::DEFAULT_LIST_LIMIT),
                offset: Some(offset),
            },
        )
        .await
        .map_err(command_error)?;
        let next_cursor = page.pagination.next_offset.map(|offset| offset.to_string());
        let resources = page
            .meetings
            .into_iter()
            .map(|meeting| {
                let name = if meeting.title.trim().is_empty() {
                    "Untitled meeting".to_string()
                } else {
                    meeting.title
                };
                Resource::new(format!("librelog://meetings/{}", meeting.id), name)
                    .with_description("Librelog meeting context")
                    .with_mime_type("text/markdown")
            })
            .collect();

        let mut result = ListResourcesResult::with_all_items(resources);
        result.next_cursor = next_cursor;
        Ok(result)
    }

    async fn list_resource_templates(
        &self,
        _params: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> std::result::Result<ListResourceTemplatesResult, McpError> {
        Ok(ListResourceTemplatesResult::with_all_items(vec![
            ResourceTemplate::new("librelog://meetings/{meeting_id}", "Librelog meeting")
                .with_description("Meeting metadata, note, summaries, people, and action items")
                .with_mime_type("text/markdown"),
            ResourceTemplate::new(
                "librelog://meetings/{meeting_id}/transcript{?offset,limit}",
                "Librelog meeting transcript",
            )
            .with_description("A bounded page of meeting transcript text")
            .with_mime_type("text/plain"),
            ResourceTemplate::new("librelog://series/{series_id}", "Librelog meeting series")
                .with_description("Recurring meeting history")
                .with_mime_type("text/markdown"),
        ]))
    }

    async fn read_resource(
        &self,
        params: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> std::result::Result<ReadResourceResponse, McpError> {
        let request = parse_resource_uri(&params.uri)?;
        let contents = match request {
            ResourceRequest::Meeting { meeting_id } => {
                let meeting =
                    access::get_meeting(self.db.pool(), access::GetMeetingInput { meeting_id })
                        .await
                        .map_err(command_error)?;
                ResourceContents::text(meeting.to_markdown(), params.uri)
                    .with_mime_type("text/markdown")
            }
            ResourceRequest::Transcript {
                meeting_id,
                offset,
                limit,
            } => {
                let page = access::get_meeting_transcript(
                    self.db.pool(),
                    access::GetMeetingTranscriptInput {
                        meeting_id,
                        offset: Some(offset),
                        limit: Some(limit),
                    },
                )
                .await
                .map_err(command_error)?;
                ResourceContents::text(page.text, params.uri).with_mime_type("text/plain")
            }
            ResourceRequest::Series { series_id } => {
                let page = access::list_meetings(
                    self.db.pool(),
                    access::ListMeetingsInput {
                        query: None,
                        series_id: Some(series_id),
                        folder_path: None,
                        limit: Some(100),
                        offset: Some(0),
                    },
                )
                .await
                .map_err(command_error)?;
                let text = page
                    .meetings
                    .into_iter()
                    .map(|meeting| {
                        let title = if meeting.title.is_empty() {
                            "Untitled"
                        } else {
                            &meeting.title
                        };
                        let date = if meeting.started_at.is_empty() {
                            &meeting.created_at
                        } else {
                            &meeting.started_at
                        };
                        format!("- {date} — [{title}](librelog://meetings/{})", meeting.id)
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                ResourceContents::text(text, params.uri).with_mime_type("text/markdown")
            }
        };

        Ok(ReadResourceResult::new(vec![contents]).into())
    }
}

pub async fn serve(
    db: Arc<anlg_db_core::Db>,
    annotations: std::path::PathBuf,
) -> crate::Result<()> {
    let running = LibrelogMcpServer::with_annotations(db, annotations)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| Error::operation("start MCP server", error.to_string()))?;
    running
        .waiting()
        .await
        .map_err(|error| Error::operation("run MCP server", error.to_string()))?;
    Ok(())
}

fn parse_resource_uri(uri: &str) -> std::result::Result<ResourceRequest, McpError> {
    let url = url::Url::parse(uri)
        .map_err(|_| McpError::invalid_params("invalid Librelog resource URI", None))?;
    if url.scheme() != "librelog" {
        return Err(McpError::invalid_params(
            "resource URI must use the librelog scheme",
            None,
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| McpError::invalid_params("resource URI is missing a type", None))?;
    let segments = url
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    match (host, segments.as_slice()) {
        ("meetings", [meeting_id]) => Ok(ResourceRequest::Meeting {
            meeting_id: (*meeting_id).to_string(),
        }),
        ("meetings", [meeting_id, "transcript"]) => {
            let mut offset = 0;
            let mut limit = access::DEFAULT_TRANSCRIPT_LIMIT;
            for (key, value) in url.query_pairs() {
                match key.as_ref() {
                    "offset" => {
                        offset = value.parse().map_err(|_| {
                            McpError::invalid_params("transcript offset must be an integer", None)
                        })?;
                    }
                    "limit" => {
                        limit = value.parse::<u32>().map_err(|_| {
                            McpError::invalid_params("transcript limit must be an integer", None)
                        })?;
                    }
                    _ => {}
                }
            }
            Ok(ResourceRequest::Transcript {
                meeting_id: (*meeting_id).to_string(),
                offset,
                limit: limit.clamp(1, access::MAX_TRANSCRIPT_LIMIT),
            })
        }
        ("series", [series_id]) => Ok(ResourceRequest::Series {
            series_id: (*series_id).to_string(),
        }),
        _ => Err(McpError::invalid_params(
            "unsupported Librelog resource URI",
            None,
        )),
    }
}

fn structured(value: &impl Serialize) -> std::result::Result<CallToolResult, McpError> {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(internal_error)
}

fn internal_error(error: impl std::fmt::Display) -> McpError {
    McpError::internal_error(error.to_string(), None)
}

fn command_error(error: access::Error) -> McpError {
    match error {
        access::Error::NotFound(what) => {
            McpError::invalid_params(format!("{what} not found"), None)
        }
        other => internal_error(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::transport::{IntoTransport, Transport};
    use serde_json::Value;

    #[test]
    fn parses_supported_resource_uris_and_bounds_transcript_limit() {
        assert_eq!(
            parse_resource_uri("librelog://meetings/meeting-1").unwrap(),
            ResourceRequest::Meeting {
                meeting_id: "meeting-1".to_string()
            }
        );
        assert_eq!(
            parse_resource_uri("librelog://meetings/meeting-1/transcript?offset=4&limit=900")
                .unwrap(),
            ResourceRequest::Transcript {
                meeting_id: "meeting-1".to_string(),
                offset: 4,
                limit: access::MAX_TRANSCRIPT_LIMIT,
            }
        );
        assert!(parse_resource_uri("file:///tmp/meeting").is_err());
    }

    #[tokio::test]
    async fn list_tool_returns_structured_meeting_data() {
        let db = anlg_db_core::Db::connect_memory_plain().await.unwrap();
        anlg_db_app::prepare_schema(&db).await.unwrap();
        sqlx::query(
            "INSERT INTO sessions (id, title, started_at, folder_path)
             VALUES
             ('meeting-1', 'Planning', '2026-07-13', 'Clients/ACME'),
             ('meeting-2', 'Planning retro', '2026-07-12', '')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        let server = LibrelogMcpServer::new(Arc::new(db));

        let result = server
            .list_meetings(Parameters(access::ListMeetingsInput {
                query: Some("plan".to_string()),
                series_id: None,
                folder_path: Some("Clients".to_string()),
                limit: None,
                offset: None,
            }))
            .await
            .unwrap();

        let meetings = result.structured_content.unwrap();
        assert_eq!(meetings["meetings"][0]["id"], "meeting-1");
        assert_eq!(meetings["meetings"][0]["title"], "Planning");
        assert_eq!(meetings["meetings"][0]["folder_path"], "Clients/ACME");
        assert_eq!(meetings["pagination"]["returned"], 1);
        assert!(meetings["pagination"]["next_offset"].is_null());

        let unfiled = server
            .get_meeting(Parameters(access::GetMeetingInput {
                meeting_id: "meeting-2".to_string(),
            }))
            .await
            .unwrap()
            .structured_content
            .unwrap();
        assert!(unfiled["folder_path"].is_null());

        let folders = server
            .list_folders(Parameters(access::ListFoldersInput::default()))
            .await
            .unwrap()
            .structured_content
            .unwrap();
        assert_eq!(folders["folders"][1]["path"], "Clients/ACME");
        assert_eq!(folders["folders"][1]["name"], "ACME");
        assert_eq!(folders["folders"][1]["parent_path"], "Clients");
        assert!(folders["folders"][0]["parent_path"].is_null());

        let invalid = server
            .list_meetings(Parameters(access::ListMeetingsInput {
                folder_path: Some("/Clients".to_string()),
                ..Default::default()
            }))
            .await;
        assert!(invalid.is_err());
    }

    fn annotation(root: &std::path::Path, created_at_ms: u64) -> std::path::PathBuf {
        use anlg_annotate_core as core;
        let dir = root.join(core::new_bundle_id());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(core::AUDIO_FILE), b"wav").unwrap();
        let gray = |t: u64| core::RgbaFrame::new(t, 64, 40, [90, 90, 90, 255].repeat(64 * 40));
        let recording = core::Recording {
            created_at_ms,
            duration_ms: 3_000,
            target: core::Target {
                width: 1512.0,
                height: 982.0,
                scale: 2.0,
                app: Some("Terminal".into()),
                window_title: Some("zsh".into()),
            },
            transcript: core::Transcript {
                source: "test".into(),
                text: "This button is broken.".into(),
                ..Default::default()
            },
            strokes: Vec::new(),
            candidates: (0..6).map(|i| gray(i * 500)).collect(),
            video_offset_ms: 0,
        };
        core::finalize(&dir, recording, &mut |_: &[u64]| Vec::new()).unwrap();
        dir
    }

    #[tokio::test]
    async fn annotation_tools_list_newest_first_and_return_the_contact_sheet_image() {
        let root = tempfile::tempdir().unwrap();
        let older = annotation(root.path(), 1_000);
        let newer = annotation(root.path(), 2_000);
        let db = anlg_db_core::Db::connect_memory_plain().await.unwrap();
        let server = LibrelogMcpServer::with_annotations(Arc::new(db), root.path().to_path_buf());

        let list = server
            .list_annotations(Parameters(annotations::ListAnnotationsInput {
                limit: None,
            }))
            .await
            .unwrap()
            .structured_content
            .unwrap();
        let ids: Vec<_> = list["annotations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["id"].as_str().unwrap().to_owned())
            .collect();
        let name = |dir: &std::path::Path| dir.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(ids, [name(&newer), name(&older)]);
        assert_eq!(list["annotations"][0]["app"], "Terminal");

        let latest = server
            .get_annotation(Parameters(annotations::GetAnnotationInput { id: None }))
            .await
            .unwrap();
        let detail = latest.structured_content.clone().unwrap();
        assert_eq!(detail["id"], name(&newer).as_str());
        assert_eq!(detail["transcript"], "This button is broken.");
        assert!(
            detail["summary"]
                .as_str()
                .unwrap()
                .contains("This button is broken.")
        );
        assert!(detail["video"].is_null());
        assert!(detail["audio"].as_str().unwrap().ends_with("audio.wav"));
        assert!(!detail["key_frames"].as_array().unwrap().is_empty());
        let image = serde_json::to_value(&latest.content).unwrap();
        assert!(
            image
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["type"] == "image" && c["mimeType"] == "image/png")
        );

        let older_detail = server
            .get_annotation(Parameters(annotations::GetAnnotationInput {
                id: Some(name(&older)),
            }))
            .await
            .unwrap()
            .structured_content
            .unwrap();
        assert_eq!(older_detail["created_at_ms"], 1_000);
        for id in ["../etc", "annotation-missing"] {
            assert!(
                server
                    .get_annotation(Parameters(annotations::GetAnnotationInput {
                        id: Some(id.into()),
                    }))
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn client_server_handshake_lists_tools_and_resources() {
        let db = anlg_db_core::Db::connect_memory_plain().await.unwrap();
        anlg_db_app::prepare_schema(&db).await.unwrap();
        sqlx::query(
            "INSERT INTO sessions (id, title, started_at) VALUES ('meeting-1', 'Planning', '2026-07-13')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
        let server = LibrelogMcpServer::new(Arc::new(db));
        let info = server.get_info();
        let server_handle = tokio::spawn(async move { server.serve(server_transport).await });

        let client = ().serve(client_transport).await.unwrap();
        let tools = client.list_all_tools().await.unwrap();
        let templates = client.list_all_resource_templates().await.unwrap();
        let resources = client.list_all_resources().await.unwrap();
        insta::assert_json_snapshot!(
            "mcp_contract",
            canonicalize_json(serde_json::json!({
                "protocol_version": info.protocol_version,
                "instructions": info.instructions,
                "tools": tools,
                "resource_templates": templates,
            }))
        );

        let mut tool_names = tools
            .iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();
        tool_names.sort();
        assert_eq!(
            tool_names,
            [
                "decline_proposal",
                "export_meeting",
                "get_annotation",
                "get_meeting",
                "get_meeting_transcript",
                "get_proposal",
                "get_recording_import",
                "get_recurring_meeting_history",
                "import_recording",
                "list_annotations",
                "list_folders",
                "list_meetings",
                "list_proposals",
                "propose_memo_edit",
                "propose_summary_edit",
            ]
        );
        let mcp_docs = include_str!("../../../docs/reference/mcp.mdx");
        let mcp_skill = include_str!("../../../skills/librelog/references/mcp.md");
        for tool_name in &tool_names {
            assert!(
                mcp_docs.contains(tool_name),
                "MCP docs are missing `{tool_name}`"
            );
            assert!(
                mcp_skill.contains(tool_name),
                "Librelog skill is missing `{tool_name}`"
            );
        }
        for tool in tools {
            let properties = tool
                .input_schema
                .get("properties")
                .and_then(Value::as_object)
                .expect("tool input properties");
            for parameter in properties.keys() {
                assert!(
                    mcp_docs.contains(&format!("`{parameter}`")),
                    "MCP docs are missing `{parameter}`"
                );
            }
            assert_eq!(
                tool.output_schema
                    .as_ref()
                    .and_then(|schema| schema.get("type"))
                    .and_then(Value::as_str),
                Some("object")
            );
            let annotations = tool.annotations.expect("tool annotations");
            let write_tool = matches!(
                tool.name.as_ref(),
                "propose_summary_edit"
                    | "propose_memo_edit"
                    | "decline_proposal"
                    | "import_recording"
            );
            assert_eq!(annotations.read_only_hint, Some(!write_tool));
            assert_eq!(annotations.destructive_hint, Some(false));
            assert_eq!(annotations.idempotent_hint, Some(!write_tool));
            assert_eq!(
                annotations.open_world_hint,
                Some(tool.name == "import_recording")
            );
        }

        let mut template_contract = templates
            .iter()
            .map(|template| {
                (
                    template.name.clone(),
                    template.uri_template.clone(),
                    template.annotations.clone(),
                )
            })
            .collect::<Vec<_>>();
        template_contract.sort_by(|left, right| left.1.cmp(&right.1));
        assert_eq!(
            template_contract,
            [
                (
                    "Librelog meeting".to_string(),
                    "librelog://meetings/{meeting_id}".to_string(),
                    None,
                ),
                (
                    "Librelog meeting transcript".to_string(),
                    "librelog://meetings/{meeting_id}/transcript{?offset,limit}".to_string(),
                    None,
                ),
                (
                    "Librelog meeting series".to_string(),
                    "librelog://series/{series_id}".to_string(),
                    None,
                ),
            ]
        );
        for (_, uri, _) in &template_contract {
            assert!(mcp_docs.contains(uri), "MCP docs are missing `{uri}`");
            assert!(mcp_skill.contains(uri), "Librelog skill is missing `{uri}`");
        }
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].name, "Planning");
        assert_eq!(resources[0].uri, "librelog://meetings/meeting-1");
        assert!(resources[0].annotations.is_none());

        client.cancel().await.unwrap();
        let server = server_handle.await.unwrap().unwrap();
        server.cancel().await.unwrap();
    }

    #[tokio::test]
    async fn current_client_discovers_and_lists_tools_without_initialize() {
        let db = Arc::new(anlg_db_core::Db::connect_memory_plain().await.unwrap());
        anlg_db_app::prepare_schema(&db).await.unwrap();
        let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
        let server = LibrelogMcpServer::new(db);
        let server_task =
            tokio::spawn(async move { server.serve(server_transport).await.unwrap() });
        let mut client = IntoTransport::<rmcp::RoleClient, _, _>::into_transport(client_transport);

        let mut discover = DiscoverRequest::new(DiscoverRequestParams {});
        discover.extensions.insert(current_client_meta());
        client
            .send(ClientJsonRpcMessage::request(
                ClientRequest::DiscoverRequest(discover),
                RequestId::Number(1),
            ))
            .await
            .unwrap();
        let discover = client.receive().await.unwrap();
        let discover = serde_json::to_value(discover).unwrap();
        assert!(
            discover["result"]["supportedVersions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|version| version == "2026-07-28")
        );

        let mut list_tools = ListToolsRequest {
            method: Default::default(),
            params: None,
            extensions: Default::default(),
        };
        list_tools.extensions.insert(current_client_meta());
        client
            .send(ClientJsonRpcMessage::request(
                ClientRequest::ListToolsRequest(list_tools),
                RequestId::Number(2),
            ))
            .await
            .unwrap();
        let tools = client.receive().await.unwrap();
        let tools = serde_json::to_value(tools).unwrap();
        assert_eq!(tools["result"]["resultType"], "complete");
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 15);

        drop(client);
        server_task.await.unwrap().cancel().await.unwrap();
    }

    fn current_client_meta() -> RequestMetaObject {
        RequestMetaObject::with_client_context(
            ProtocolVersion::V_2026_07_28,
            Implementation::new("librelog-test", "1.0.0"),
            ClientCapabilities::default(),
        )
    }

    fn canonicalize_json(value: Value) -> Value {
        match value {
            Value::Object(object) => Value::Object(
                object
                    .into_iter()
                    .map(|(key, value)| (key, canonicalize_json(value)))
                    .collect::<std::collections::BTreeMap<_, _>>()
                    .into_iter()
                    .collect(),
            ),
            Value::Array(values) => {
                Value::Array(values.into_iter().map(canonicalize_json).collect())
            }
            value => value,
        }
    }
}
