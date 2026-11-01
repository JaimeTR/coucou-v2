// GitHub pulse and contribution calendar — parsing, alert detection and the
// staleness rule live here, away from the network, so they can be tested.
//
// The pollers that use them are in integrations.rs.

use serde::Serialize;
use serde_json::Value;

// ── CI and review states ──────────────────────────────────────────────────────

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CiState {
    Pending,
    Success,
    Failure,
    Unknown,
}

impl CiState {
    pub fn from_github(raw: Option<&str>) -> Self {
        match raw.map(str::to_ascii_uppercase).as_deref() {
            Some("PENDING") | Some("EXPECTED") => CiState::Pending,
            Some("SUCCESS") => CiState::Success,
            Some("ERROR") | Some("FAILURE") => CiState::Failure,
            _ => CiState::Unknown,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    Pending,
    Unknown,
}

impl ReviewState {
    pub fn from_github(raw: Option<&str>) -> Self {
        match raw.map(str::to_ascii_uppercase).as_deref() {
            Some("APPROVED") => ReviewState::Approved,
            Some("CHANGES_REQUESTED") => ReviewState::ChangesRequested,
            Some("REVIEW_REQUIRED") => ReviewState::Pending,
            _ => ReviewState::Unknown,
        }
    }
}

// ── Pulse ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPr {
    pub id: String,
    pub title: String,
    pub url: String,
    pub repo: String,
    pub number: i64,
    pub is_draft: bool,
    pub ci: CiState,
    pub review: ReviewState,
    pub head_sha: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoCi {
    pub repo: String,
    pub url: String,
    pub branch: String,
    pub ci: CiState,
    pub head_sha: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitHubPulse {
    pub login: String,
    #[serde(rename = "myPRs")]
    pub my_prs: Vec<GitHubPr>,
    #[serde(rename = "toReview")]
    pub to_review: Vec<GitHubPr>,
    #[serde(rename = "mainCI")]
    pub main_ci: Vec<GitHubRepoCi>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum GitHubEvent {
    #[serde(rename = "ciFailed")]
    CiFailed { #[serde(rename = "prId")] pr_id: String },
    #[serde(rename = "ciPassed")]
    CiPassed { #[serde(rename = "prId")] pr_id: String },
    #[serde(rename = "mainFailed")]
    MainFailed { repo: String },
    #[serde(rename = "reviewRequested")]
    ReviewRequested { #[serde(rename = "prId")] pr_id: String },
    #[serde(rename = "reviewApproved")]
    ReviewApproved { #[serde(rename = "prId")] pr_id: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GitHubDiff {
    pub prs_changed: Vec<String>,
    pub ci_changed: Vec<String>,
    pub reviews_changed: Vec<String>,
}

impl GitHubPulse {
    pub fn parse(_payload: &Value, _fetched_at: u64) -> Option<Self> {
        None
    }

    pub fn diff_for_the_island(&self, _previous: &Option<GitHubPulse>) -> Vec<GitHubEvent> {
        Vec::new()
    }
}
// ── Activity (contribution calendar) ──────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityDay {
    pub date: String,
    pub count: i64,
    pub level: u8,
    pub weekday: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitHubActivity {
    pub total: i64,
    pub weeks: Vec<Vec<ActivityDay>>,
    pub fetched_at: u64,
}

impl GitHubActivity {
    pub fn parse(_payload: &Value, _fetched_at: u64) -> Option<Self> {
        None
    }
}

pub fn graphql_error_count(_payload: &Value) -> usize {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_pulse() -> Value {
        serde_json::json!({
            "login": "testuser",
            "myPRs": [
                {"id": "a/b#1", "title": "Fix typo", "url": "https://github.com/a/b/pull/1", "repo": "a/b", "number": 1, "isDraft": false, "ci": "SUCCESS", "review": "APPROVED", "headSha": "aaa"}
            ],
            "toReview": [],
            "mainCI": [{"repo": "a/b", "url": "https://github.com/a/b", "branch": "main", "ci": "SUCCESS", "headSha": "bbb"}]
        })
    }

    #[test]
    #[ignore = "GitHubPulse::parse is still a stub"]
    fn parses_pulse_shape() {
        let p = GitHubPulse::parse(&valid_pulse(), 7).unwrap();
        assert_eq!(p.login, "testuser");
        assert_eq!(p.my_prs.len(), 1);
        assert_eq!(p.my_prs[0].id, "a/b#1");
        assert_eq!(p.my_prs[0].ci, CiState::Success);
        assert_eq!(p.my_prs[0].review, ReviewState::Approved);
        assert_eq!(p.main_ci.len(), 1);
        assert_eq!(p.fetched_at, 7);
    }

    #[test]
    fn rejects_bad_pulse() {
        assert!(GitHubPulse::parse(&serde_json::json!("garbage"), 0).is_none());
        assert!(GitHubPulse::parse(&serde_json::json!({}), 0).is_none());
    }

    #[test]
    fn event_serialization() {
        let v = serde_json::to_value(GitHubEvent::CiFailed { pr_id: "a/b#1".into() }).unwrap();
        assert_eq!(v, serde_json::json!({"kind": "ciFailed", "prId": "a/b#1"}));
        let v = serde_json::to_value(GitHubEvent::MainFailed { repo: "a/b".into() }).unwrap();
        assert_eq!(v, serde_json::json!({"kind": "mainFailed", "repo": "a/b"}));
    }
}