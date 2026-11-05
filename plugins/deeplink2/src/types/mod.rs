mod auth_callback;

pub use auth_callback::*;

use serde::{Deserialize, Serialize};
use specta::Type;
use std::str::FromStr;

#[derive(Debug, Clone, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct DeepLinkEvent(pub DeepLink);

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "to", content = "search")]
pub enum DeepLink {
    #[serde(rename = "/auth/callback")]
    AuthCallback(AuthCallbackSearch),
}

impl DeepLink {
    pub fn path(&self) -> &'static str {
        match self {
            DeepLink::AuthCallback(_) => "/auth/callback",
        }
    }
}

impl FromStr for DeepLink {
    type Err = crate::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let parsed = url::Url::parse(s)?;

        let host = parsed.host_str().unwrap_or("");
        let path = parsed.path().trim_start_matches('/');
        let full_path = if path.is_empty() {
            host.to_string()
        } else {
            format!("{}/{}", host, path)
        };

        let query = parsed.query().unwrap_or("");

        match full_path.as_str() {
            "auth/callback" => Ok(DeepLink::AuthCallback(serde_qs::from_str(query)?)),
            _ => Err(crate::Error::UnknownPath(full_path)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_authorization_code_callbacks() {
        for (url, code, state) in [
            (
                "local://auth/callback?code=codex-code&state=s1&scope=openid",
                "codex-code",
                "s1",
            ),
            (
                "librelog://auth/callback?code=ac_nf5hq&state=xYc5ZmNlqtWTu3BIbfbVQg",
                "ac_nf5hq",
                "xYc5ZmNlqtWTu3BIbfbVQg",
            ),
        ] {
            let DeepLink::AuthCallback(search) = DeepLink::from_str(url).unwrap();

            assert_eq!(search.code.as_deref(), Some(code), "{url}");
            assert_eq!(search.state.as_deref(), Some(state), "{url}");
        }
    }

    #[test]
    fn rejects_removed_hosted_service_links() {
        for url in [
            "librelog://billing/refresh",
            "librelog://integration/callback?integration_id=x&status=success",
            "librelog://onboarding-demo/complete",
            "librelog://share/open?mode=account&share_id=x",
        ] {
            assert!(DeepLink::from_str(url).is_err(), "{url}");
        }
    }
}
