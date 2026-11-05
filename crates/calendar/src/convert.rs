use anlg_apple_calendar::types::{
    AppleCalendar, AppleEvent, EventStatus as AppleEventStatus, Participant, ParticipantRole,
    ParticipantStatus, ParticipantType,
};
use anlg_calendar_interface::{
    AttendanceResponseCounts, AttendanceRosterStatus, AttendeeRole, AttendeeStatus, CalendarEvent,
    CalendarListItem, CalendarProviderType, EventAttendance, EventAttendee, EventPerson,
    EventStatus, SelfAttendanceStatus,
};
use std::collections::HashSet;

pub fn convert_apple_calendars(calendars: Vec<AppleCalendar>) -> Vec<CalendarListItem> {
    calendars
        .into_iter()
        .map(|calendar| {
            let raw = serde_json::to_string(&calendar).unwrap_or_default();

            CalendarListItem {
                provider: CalendarProviderType::Apple,
                id: calendar.id,
                title: calendar.title,
                source: Some(calendar.source.title),
                color: calendar.color.map(apple_color_to_css),
                is_primary: None,
                can_edit: Some(calendar.allows_content_modifications && !calendar.is_immutable),
                raw,
            }
        })
        .collect()
}

fn apple_color_to_css(color: anlg_apple_calendar::types::CalendarColor) -> String {
    format!(
        "rgba({}, {}, {}, {})",
        (color.red * 255.0).round(),
        (color.green * 255.0).round(),
        (color.blue * 255.0).round(),
        color.alpha,
    )
}

pub fn convert_apple_events(events: Vec<AppleEvent>) -> Vec<CalendarEvent> {
    let mut occurrences = std::collections::BTreeMap::new();
    for event in events {
        let rank = (
            event.is_detached,
            event.last_modified_date,
            matches!(event.status, AppleEventStatus::Canceled),
            event.event_identifier.clone(),
        );
        let mut converted = convert_apple_event(event);
        match occurrences.entry(converted.id.clone()) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert((rank, converted));
            }
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                let (current_rank, current) = entry.get_mut();
                let mut aliases = current.legacy_ids.clone();
                aliases.append(&mut converted.legacy_ids);
                aliases.sort();
                aliases.dedup();
                if rank > *current_rank {
                    *current_rank = rank;
                    *current = converted;
                }
                current.legacy_ids = aliases;
            }
        }
    }
    occurrences.into_values().map(|(_, event)| event).collect()
}

fn convert_apple_event(event: AppleEvent) -> CalendarEvent {
    let raw = serde_json::to_string(&event).unwrap_or_default();
    let attendance = Some(convert_apple_attendance(&event));

    let (id, legacy_ids) = crate::apple_identity::identity(&event);

    let organizer = event.organizer.as_ref().map(convert_person);
    let attendees = event.attendees.iter().map(convert_apple_attendee).collect();

    let recurring_event_id = if event.has_recurrence_rules || event.is_detached {
        event
            .recurrence
            .as_ref()
            .map(|recurrence| {
                crate::apple_identity::without_occurrence_suffix(
                    &recurrence.series_identifier,
                    &event,
                )
                .to_string()
            })
            .or_else(|| {
                [&event.external_identifier, &event.calendar_item_identifier]
                    .into_iter()
                    .find(|identifier| !identifier.is_empty())
                    .map(|identifier| {
                        crate::apple_identity::without_occurrence_suffix(identifier, &event)
                            .to_string()
                    })
            })
    } else {
        None
    };

    let meeting_link = resolve_meeting_link(event.location.as_deref(), event.notes.as_deref());

    CalendarEvent {
        id,
        legacy_ids,
        calendar_id: event.calendar.id,
        provider: CalendarProviderType::Apple,
        external_id: event.external_identifier,
        title: event.title,
        description: event.notes,
        location: event.location,
        url: event.url,
        meeting_link,
        started_at: event.start_date.to_rfc3339(),
        ended_at: event.end_date.to_rfc3339(),
        timezone: event.time_zone,
        is_all_day: event.is_all_day,
        status: convert_apple_status(event.status),
        organizer,
        attendees,
        attendance,
        has_recurrence_rules: event.has_recurrence_rules,
        recurring_event_id,
        raw,
    }
}

#[derive(Clone, Copy)]
enum AttendanceResponse {
    Accepted,
    Tentative,
    Pending,
    Declined,
    Unknown,
}

impl AttendanceResponse {
    fn add_to(self, counts: &mut AttendanceResponseCounts) {
        match self {
            Self::Accepted => counts.accepted += 1,
            Self::Tentative => counts.tentative += 1,
            Self::Pending => counts.pending += 1,
            Self::Declined => counts.declined += 1,
            Self::Unknown => counts.unknown += 1,
        }
    }
}

#[derive(Default)]
struct SeenAttendees {
    ids: HashSet<String>,
    emails: HashSet<String>,
}

impl SeenAttendees {
    fn insert(&mut self, id: Option<&str>, email: Option<&str>) -> bool {
        let id = normalized_identity(id);
        let email = normalized_identity(email);
        if id.as_ref().is_some_and(|id| self.ids.contains(id))
            || email
                .as_ref()
                .is_some_and(|email| self.emails.contains(email))
        {
            return false;
        }

        if let Some(id) = id {
            self.ids.insert(id);
        }
        if let Some(email) = email {
            self.emails.insert(email);
        }
        true
    }
}

fn normalized_identity(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
}

fn convert_apple_attendance(event: &AppleEvent) -> EventAttendance {
    let self_status = if event
        .organizer
        .as_ref()
        .is_some_and(|organizer| organizer.is_current_user)
    {
        SelfAttendanceStatus::Organizer
    } else if let Some(attendee) = event
        .attendees
        .iter()
        .find(|attendee| attendee.is_current_user)
    {
        apple_self_attendance_status(&attendee.status)
    } else {
        SelfAttendanceStatus::Unknown
    };

    let roster_status = if event.attendees.iter().any(|attendee| {
        matches!(
            attendee.participant_type,
            ParticipantType::Group | ParticipantType::Unknown
        )
    }) || (event.has_attendees && event.attendees.is_empty())
    {
        AttendanceRosterStatus::Incomplete
    } else {
        AttendanceRosterStatus::Complete
    };

    let mut others = AttendanceResponseCounts::default();
    let mut seen = SeenAttendees::default();
    let has_external_organizer = event
        .organizer
        .as_ref()
        .is_some_and(|organizer| !organizer.is_current_user);
    if let Some(organizer) = event.organizer.as_ref().filter(|_| has_external_organizer) {
        insert_apple_identity(&mut seen, organizer);
        AttendanceResponse::Accepted.add_to(&mut others);
    }

    for attendee in &event.attendees {
        if attendee.is_current_user
            || matches!(
                attendee.participant_type,
                ParticipantType::Room | ParticipantType::Resource
            )
            || matches!(attendee.role, ParticipantRole::NonParticipant)
        {
            continue;
        }
        if has_external_organizer && matches!(attendee.role, ParticipantRole::Chair) {
            continue;
        }
        if !insert_apple_identity(&mut seen, attendee) {
            continue;
        }
        if matches!(attendee.role, ParticipantRole::Chair) {
            AttendanceResponse::Accepted.add_to(&mut others);
        } else {
            apple_attendance_response(&attendee.status).add_to(&mut others);
        }
    }

    EventAttendance {
        self_status,
        roster_status,
        others,
    }
}

fn insert_apple_identity(seen: &mut SeenAttendees, participant: &Participant) -> bool {
    let id = participant
        .contact
        .as_ref()
        .map(|contact| contact.identifier.as_str());
    seen.insert(id, participant.email.as_deref())
}

fn apple_self_attendance_status(status: &ParticipantStatus) -> SelfAttendanceStatus {
    match status {
        ParticipantStatus::Accepted
        | ParticipantStatus::Delegated
        | ParticipantStatus::Completed
        | ParticipantStatus::InProgress => SelfAttendanceStatus::Accepted,
        ParticipantStatus::Tentative => SelfAttendanceStatus::Tentative,
        ParticipantStatus::Declined => SelfAttendanceStatus::Declined,
        ParticipantStatus::Pending => SelfAttendanceStatus::Pending,
        ParticipantStatus::Unknown => SelfAttendanceStatus::Unknown,
    }
}

fn apple_attendance_response(status: &ParticipantStatus) -> AttendanceResponse {
    match status {
        ParticipantStatus::Accepted
        | ParticipantStatus::Delegated
        | ParticipantStatus::Completed
        | ParticipantStatus::InProgress => AttendanceResponse::Accepted,
        ParticipantStatus::Tentative => AttendanceResponse::Tentative,
        ParticipantStatus::Declined => AttendanceResponse::Declined,
        ParticipantStatus::Pending => AttendanceResponse::Pending,
        ParticipantStatus::Unknown => AttendanceResponse::Unknown,
    }
}

fn convert_apple_status(status: AppleEventStatus) -> EventStatus {
    match status {
        AppleEventStatus::None | AppleEventStatus::Confirmed => EventStatus::Confirmed,
        AppleEventStatus::Tentative => EventStatus::Tentative,
        AppleEventStatus::Canceled => EventStatus::Cancelled,
    }
}

fn convert_person(participant: &Participant) -> EventPerson {
    EventPerson {
        name: participant.name.clone(),
        email: participant.email.clone(),
        is_current_user: participant.is_current_user,
    }
}

fn convert_apple_attendee(participant: &Participant) -> EventAttendee {
    EventAttendee {
        name: participant.name.clone(),
        email: participant.email.clone(),
        is_current_user: participant.is_current_user,
        status: convert_apple_attendee_status(&participant.status),
        role: convert_apple_attendee_role(&participant.role),
    }
}

fn convert_apple_attendee_status(status: &ParticipantStatus) -> AttendeeStatus {
    match status {
        ParticipantStatus::Unknown | ParticipantStatus::Pending => AttendeeStatus::Pending,
        ParticipantStatus::Accepted
        | ParticipantStatus::Delegated
        | ParticipantStatus::Completed
        | ParticipantStatus::InProgress => AttendeeStatus::Accepted,
        ParticipantStatus::Tentative => AttendeeStatus::Tentative,
        ParticipantStatus::Declined => AttendeeStatus::Declined,
    }
}

fn convert_apple_attendee_role(role: &ParticipantRole) -> AttendeeRole {
    match role {
        ParticipantRole::Unknown | ParticipantRole::Required => AttendeeRole::Required,
        ParticipantRole::Optional => AttendeeRole::Optional,
        ParticipantRole::Chair => AttendeeRole::Chair,
        ParticipantRole::NonParticipant => AttendeeRole::NonParticipant,
    }
}

pub(super) fn local_date_string(
    date: &chrono::DateTime<chrono::Utc>,
    event_tz: Option<&str>,
) -> String {
    if let Some(tz_name) = event_tz
        && let Ok(tz) = tz_name.parse::<chrono_tz::Tz>()
    {
        return date.with_timezone(&tz).format("%Y-%m-%d").to_string();
    }

    date.with_timezone(&chrono::Local)
        .format("%Y-%m-%d")
        .to_string()
}

// A link parsed from the location wins over one from the description, so every
// event crosses the Tauri bridge with its final meeting link already resolved.
fn resolve_meeting_link(location: Option<&str>, description: Option<&str>) -> Option<String> {
    location
        .and_then(crate::parse_meeting_link)
        .or_else(|| description.and_then(crate::parse_meeting_link))
}

#[cfg(test)]
mod meeting_link_tests {
    use super::*;

    const MEET_LINK: &str = "https://meet.google.com/abc-defg-hij";
    const CAL_LINK: &str = "https://app.cal.com/video/abc123";

    #[test]
    fn resolve_meeting_link_precedence() {
        for (location, description, expected) in [
            (Some(MEET_LINK), Some(CAL_LINK), Some(MEET_LINK)),
            (Some("Conference room 4"), Some(CAL_LINK), Some(CAL_LINK)),
            (Some("Conference room 4"), Some("Agenda"), None),
            (None, None, None),
        ] {
            assert_eq!(
                resolve_meeting_link(location, description).as_deref(),
                expected
            );
        }
    }
}

#[cfg(test)]
mod attendance_tests {
    use super::*;

    fn attendance(event: &CalendarEvent) -> &EventAttendance {
        event.attendance.as_ref().unwrap()
    }

    fn apple_event(
        organizer: Option<serde_json::Value>,
        attendees: Vec<serde_json::Value>,
        has_attendees: bool,
    ) -> CalendarEvent {
        let event = serde_json::from_value(serde_json::json!({
            "event_identifier": "event",
            "calendar_item_identifier": "item",
            "external_identifier": "external",
            "calendar": { "id": "calendar", "title": "Calendar" },
            "title": "Meeting",
            "location": null,
            "url": null,
            "notes": null,
            "creation_date": null,
            "last_modified_date": null,
            "time_zone": "UTC",
            "start_date": "2026-09-30T10:00:00Z",
            "end_date": "2026-09-30T11:00:00Z",
            "is_all_day": false,
            "availability": "Busy",
            "status": "Confirmed",
            "has_alarms": false,
            "has_attendees": has_attendees,
            "has_notes": false,
            "has_recurrence_rules": false,
            "organizer": organizer,
            "attendees": attendees,
            "structured_location": null,
            "recurrence": null,
            "occurrence_date": null,
            "is_detached": false,
            "alarms": [],
            "birthday_contact_identifier": null,
            "is_birthday": false,
        }))
        .unwrap();
        convert_apple_event(event)
    }

    fn apple_participant(
        email: &str,
        is_current_user: bool,
        status: &str,
        participant_type: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "name": email,
            "email": email,
            "is_current_user": is_current_user,
            "role": "Required",
            "status": status,
            "participant_type": participant_type,
            "url": null,
            "contact": null,
        })
    }

    #[test]
    fn apple_maps_self_status_and_excludes_rooms_and_resources() {
        let event = apple_event(
            Some(apple_participant(
                "host@example.com",
                false,
                "Accepted",
                "Person",
            )),
            vec![
                apple_participant("HOST@example.com", false, "Declined", "Person"),
                apple_participant("me@example.com", true, "Delegated", "Person"),
                apple_participant("declined@example.com", false, "Declined", "Person"),
                apple_participant("room@example.com", false, "Accepted", "Room"),
                apple_participant("resource@example.com", false, "Accepted", "Resource"),
            ],
            true,
        );

        let attendance = attendance(&event);
        assert_eq!(attendance.self_status, SelfAttendanceStatus::Accepted);
        assert_eq!(attendance.others.accepted, 1);
        assert_eq!(attendance.others.declined, 1);
    }

    #[test]
    fn apple_organizer_and_group_or_missing_rosters_are_conservative() {
        let organizer = apple_participant("me@example.com", true, "Accepted", "Person");
        let organized = apple_event(Some(organizer), Vec::new(), false);
        let group = apple_event(
            None,
            vec![apple_participant(
                "group@example.com",
                false,
                "Pending",
                "Group",
            )],
            true,
        );
        let missing = apple_event(None, Vec::new(), true);
        let unknown_kind = apple_event(
            None,
            vec![apple_participant(
                "unknown@example.com",
                false,
                "Declined",
                "Unknown",
            )],
            true,
        );

        assert_eq!(
            attendance(&organized).self_status,
            SelfAttendanceStatus::Organizer
        );
        assert_eq!(
            attendance(&organized).roster_status,
            AttendanceRosterStatus::Complete
        );
        assert_eq!(
            attendance(&group).roster_status,
            AttendanceRosterStatus::Incomplete
        );
        assert_eq!(attendance(&group).others.pending, 1);
        assert_eq!(
            attendance(&missing).roster_status,
            AttendanceRosterStatus::Incomplete
        );
        assert_eq!(
            attendance(&unknown_kind).roster_status,
            AttendanceRosterStatus::Incomplete
        );
    }

    #[test]
    fn apple_distinguishes_unknown_from_pending_self_response() {
        let unknown = apple_event(
            None,
            vec![apple_participant(
                "me@example.com",
                true,
                "Unknown",
                "Person",
            )],
            true,
        );
        let pending = apple_event(
            None,
            vec![apple_participant(
                "me@example.com",
                true,
                "Pending",
                "Person",
            )],
            true,
        );

        assert_eq!(
            attendance(&unknown).self_status,
            SelfAttendanceStatus::Unknown
        );
        assert_eq!(
            attendance(&pending).self_status,
            SelfAttendanceStatus::Pending
        );
    }

    #[test]
    fn attendance_contract_serializes_with_stable_lowercase_values() {
        let value = serde_json::to_value(EventAttendance {
            self_status: SelfAttendanceStatus::Organizer,
            roster_status: AttendanceRosterStatus::Incomplete,
            others: AttendanceResponseCounts {
                accepted: 1,
                tentative: 2,
                pending: 3,
                declined: 4,
                unknown: 5,
            },
        })
        .unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "self_status": "organizer",
                "roster_status": "incomplete",
                "others": {
                    "accepted": 1,
                    "tentative": 2,
                    "pending": 3,
                    "declined": 4,
                    "unknown": 5,
                },
            })
        );
    }
}
