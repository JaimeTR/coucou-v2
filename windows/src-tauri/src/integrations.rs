// Integration pollers — the Rust side of StripePoller / GithubPoller /
// VercelPoller / N8nPoller / ResendPoller / NotionPoller / CalcomPoller.
//
// Same endpoints, same first-run delays and intervals as the Swift pollers. Each
// one emits an `integration` event; the island owns the badge, the sound and the
// 60 s auto-clear, exactly as the Swift handlers do.
//
// Nothing is polled until its key exists in the Credential Manager, and no
// request goes anywhere the user has not configured.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;
use crate::secrets;

const TIMEOUT: Duration = Duration::from_secs(10);

/// What the island receives. `event` is only set when something actually changed,
/// which is what drives the pill badge and the sound.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationUpdate {
    pub id: &'static str,
    pub data: Value,
    pub error: Option<String>,
    pub event: Option<IntegrationEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationEvent {
    pub success: bool,
    pub label: String,
    pub detail: Option<String>,
}

fn emit(app: &AppHandle, update: IntegrationUpdate) {
    let _ = app.emit_to(WINDOW_LABEL, "integration", update);
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .unwrap_or_default()
}

/// Set from the tray's Pause item. While it is on, nothing reaches the network:
/// pausing Coucou has to mean pausing Coucou, not just hiding the island.
pub static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::Relaxed)
}

pub fn set_paused(on: bool) {
    PAUSED.store(on, Ordering::Relaxed);
}

/// Spawns every poller with the macOS delays and intervals.
pub fn start(app: AppHandle) {
    spawn(app.clone(), "integration_vercel", 5, 30, poll_vercel);
    spawn(app.clone(), "integration_stripe", 6, 30, poll_stripe);
    spawn(app.clone(), "integration_resend", 6, 60, poll_resend);
    spawn(app.clone(), "integration_github", 3, 300, poll_github);
    spawn(app.clone(), "integration_gitlab", 7, 300, poll_gitlab);
    spawn(app.clone(), "integration_gitea", 7, 300, poll_gitea);
    spawn(app.clone(), "integration_calcom", 8, 300, poll_calcom);
    spawn(app, "integration_notion", 9, 300, poll_notion);
}

/// True when the user has this integration switched on in settings.
fn enabled(app: &AppHandle, id: &str) -> bool {
    app.try_state::<crate::Shared>()
        .map(|shared| {
            let settings = shared.settings.lock().unwrap();
            settings.active_integrations.iter().any(|x| x == id)
        })
        .unwrap_or(false)
}

fn spawn<F, Fut>(app: AppHandle, id: &'static str, delay_secs: u64, every_secs: u64, poll: F)
where
    F: Fn(AppHandle) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_secs)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(every_secs));
        loop {
            ticker.tick().await;
            // The ticker keeps its cadence; we just decline to do the work. An
            // integration the user switched off, or a paused app, must make no
            // network calls at all — CLAUDE.md allows talking only to services
            // the user configured, and a disabled one is not configured.
            if PAUSED.load(Ordering::Relaxed) || !enabled(&app, id) {
                continue;
            }
            poll(app.clone()).await;
        }
    });
}

/// One-shot refresh from the Refresh buttons in the island.
pub async fn poll_once(app: AppHandle, id: &str) {
    match id {
        "integration_stripe" => poll_stripe(app).await,
        "integration_github" => poll_github(app).await,
        "integration_gitlab" => poll_gitlab(app).await,
        "integration_gitea" => poll_gitea(app).await,
        "integration_vercel" => poll_vercel(app).await,
        "integration_resend" => poll_resend(app).await,
        "integration_notion" => poll_notion(app).await,
        "integration_calcom" => poll_calcom(app).await,
        _ => {}
    }
}

/// Remembers the newest id per integration so an event fires once, not on every poll.
struct Seen(Mutex<std::collections::HashMap<String, String>>);

static SEEN: std::sync::LazyLock<Seen> =
    std::sync::LazyLock::new(|| Seen(Mutex::new(std::collections::HashMap::new())));

/// Returns true the first time a given id is seen (and false on the very first
/// load, which only fills the card).
fn is_new(key: &str, id: &str) -> bool {
    let mut map = SEEN.0.lock().unwrap();
    match map.insert(key.to_string(), id.to_string()) {
        Some(previous) => previous != id,
        None => false, // first poll: populate silently, like the Swift pollers
    }
}

fn status_error(code: u16, unauthorised_hint: &str) -> String {
    match code {
        401 => "Clave de API no válida (401)".into(),
        403 => unauthorised_hint.into(),
        _ => format!("Error de la API {code}"),
    }
}

// ── Stripe ────────────────────────────────────────────────────────────────────

async fn poll_stripe(app: AppHandle) {
    let Some(key) = secrets::get("stripe-api-key") else { return };
    let auth = format!("Basic {}", crate::claude::base64_for(format!("{key}:").as_bytes()));
    let http = client();

    let balance = http
        .get("https://api.stripe.com/v1/balance")
        .header("Authorization", &auth)
        .send()
        .await;

    let (amount, currency) = match balance {
        Ok(r) if r.status().is_success() => {
            let json: Value = r.json().await.unwrap_or(json!({}));
            let mut buckets: Vec<Value> = Vec::new();
            for k in ["available", "pending"] {
                if let Some(arr) = json.get(k).and_then(Value::as_array) {
                    buckets.extend(arr.iter().cloned());
                }
            }
            let currency = buckets
                .first()
                .and_then(|b| b.get("currency"))
                .and_then(Value::as_str)
                .unwrap_or("eur")
                .to_string();
            let amount: i64 = buckets
                .iter()
                .filter_map(|b| b.get("amount").and_then(Value::as_i64))
                .sum();
            (amount, currency)
        }
        Ok(r) => {
            let code = r.status().as_u16();
            emit(&app, IntegrationUpdate {
                id: "integration_stripe",
                data: json!({}),
                error: Some(status_error(code, "Usa una clave secreta (sk_live_…, no pk_live_…)")),
                event: None,
            });
            return;
        }
        Err(e) => {
            emit(&app, IntegrationUpdate {
                id: "integration_stripe",
                data: json!({}),
                error: Some(format!("Sin conexión: {e}")),
                event: None,
            });
            return;
        }
    };

    let charges = http
        .get("https://api.stripe.com/v1/charges?limit=3")
        .header("Authorization", &auth)
        .send()
        .await;
    let Ok(response) = charges else { return };
    if !response.status().is_success() {
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let payments: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|c| {
                    let description = c
                        .get("description")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            c.get("billing_details")
                                .and_then(|b| b.get("name"))
                                .and_then(Value::as_str)
                        })
                        .map(str::to_string);
                    Some(json!({
                        "id": c.get("id")?.as_str()?,
                        "amount": c.get("amount")?.as_i64()?,
                        "currency": c.get("currency")?.as_str()?,
                        "description": description,
                        "createdAt": c.get("created").and_then(Value::as_i64).unwrap_or(0) * 1000,
                        "status": c.get("status").and_then(Value::as_str).unwrap_or("succeeded"),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    let newest = payments
        .first()
        .and_then(|p| p.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let event = if !newest.is_empty() && is_new("stripe", &newest) {
        let label = payments[0]
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                let cents = payments[0].get("amount").and_then(Value::as_i64).unwrap_or(0);
                format!("{:.2}", cents as f64 / 100.0)
            });
        Some(IntegrationEvent { success: true, label, detail: None })
    } else {
        None
    };

    emit(&app, IntegrationUpdate {
        id: "integration_stripe",
        data: json!({ "balance": amount, "currency": currency, "payments": payments }),
        error: None,
        event,
    });
}

// ── GitHub (and Copilot) ──────────────────────────────────────────────────────

/// One request for everything the card needs: my open PRs (with their CI), the
/// reviews I was asked for, and the PRs assigned to me — which is where
/// Copilot's coding agent puts its work.
const GITHUB_PULSE_QUERY: &str = r#"
query {
  mine: search(query: "is:pr is:open author:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
  review: search(query: "is:pr is:open review-requested:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
  assigned: search(query: "is:pr is:open assignee:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
  viewer {
    repositories(first: 10, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner url
        defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount contributionLevel } }
      }
    }
  }
}
fragment pr on PullRequest {
  number title url isDraft reviewDecision updatedAt
  author { login __typename }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  reviews(last: 30) { nodes { state author { login __typename } } }
}"#;

/// My repositories and the CI of each one's default branch (those with no CI at
/// all are left out: there is nothing to say about them).
fn repos_of(response: &Value) -> Vec<Value> {
    response
        .pointer("/data/viewer/repositories/nodes")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|n| {
                    let name = n.get("nameWithOwner").and_then(Value::as_str)?;
                    let url = n.get("url").and_then(Value::as_str)?;
                    let state = n.pointer("/defaultBranchRef/target/statusCheckRollup/state").and_then(Value::as_str)?;
                    let ci = match state {
                        "SUCCESS" => "success",
                        "FAILURE" | "ERROR" => "failure",
                        "PENDING" | "EXPECTED" => "pending",
                        _ => return None,
                    };
                    let branch = n.pointer("/defaultBranchRef/name").and_then(Value::as_str).unwrap_or("main");
                    Some(json!({ "name": name, "url": url, "branch": branch, "ci": ci }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The last weeks of the contribution calendar as levels 0-4, a column per week
/// of up to seven days, plus the year's total. `None` when GitHub sent none.
fn calendar_of(response: &Value) -> Option<Value> {
    let calendar = response.pointer("/data/viewer/contributionsCollection/contributionCalendar")?;
    let total = calendar.get("totalContributions").and_then(Value::as_i64)?;
    let level = |raw: &str| match raw {
        "FIRST_QUARTILE" => 1,
        "SECOND_QUARTILE" => 2,
        "THIRD_QUARTILE" => 3,
        "FOURTH_QUARTILE" => 4,
        _ => 0,
    };
    let weeks: Vec<Vec<u8>> = calendar
        .get("weeks")?
        .as_array()?
        .iter()
        .map(|w| {
            w.get("contributionDays")
                .and_then(Value::as_array)
                .map(|days| {
                    days.iter()
                        .map(|d| level(d.get("contributionLevel").and_then(Value::as_str).unwrap_or("NONE")))
                        .take(7)
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect();
    // The card has room for about five months.
    let keep = weeks.len().saturating_sub(22);
    Some(json!({ "total": total, "weeks": &weeks[keep..] }))
}

fn is_copilot(login: &str) -> bool {
    login.to_lowercase().contains("copilot")
}

fn ci_of(node: &Value) -> &'static str {
    match node
        .pointer("/commits/nodes/0/commit/statusCheckRollup/state")
        .and_then(Value::as_str)
        .unwrap_or("")
    {
        "SUCCESS" => "success",
        "FAILURE" | "ERROR" => "failure",
        "PENDING" | "EXPECTED" => "pending",
        _ => "unknown",
    }
}

/// One pull request as the card needs it.
fn pr_item(node: &Value) -> Option<Value> {
    let url = node.get("url").and_then(Value::as_str)?;
    let author = node.pointer("/author/login").and_then(Value::as_str).unwrap_or("");
    let reviewed_by_copilot = node
        .pointer("/reviews/nodes")
        .and_then(Value::as_array)
        .map(|reviews| {
            reviews.iter().any(|r| {
                r.pointer("/author/login").and_then(Value::as_str).map(is_copilot).unwrap_or(false)
            })
        })
        .unwrap_or(false);
    Some(json!({
        "number": node.get("number").and_then(Value::as_i64).unwrap_or(0),
        "title": node.get("title").and_then(Value::as_str).unwrap_or("(untitled)"),
        "url": url,
        "repo": node.pointer("/repository/nameWithOwner").and_then(Value::as_str).unwrap_or(""),
        "isDraft": node.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        "reviewDecision": node.get("reviewDecision").and_then(Value::as_str).unwrap_or(""),
        "ci": ci_of(node),
        "author": author,
        "isCopilot": is_copilot(author),
        "copilotReviewed": reviewed_by_copilot,
        "updatedAt": node.get("updatedAt").and_then(Value::as_str).unwrap_or(""),
    }))
}

fn nodes_of<'a>(data: &'a Value, alias: &str) -> Vec<&'a Value> {
    data.pointer(&format!("/data/{alias}/nodes"))
        .and_then(Value::as_array)
        .map(|list| list.iter().filter(|n| n.is_object()).collect())
        .unwrap_or_default()
}

/// The GraphQL answer boiled down to what the card shows:
///   mine      my open PRs, with CI and whether Copilot reviewed them
///   toReview  reviews I was asked for (Copilot's own PRs are listed apart)
///   copilot   PRs Copilot's coding agent opened for me
fn parse_pulse(response: &Value) -> Value {
    let items = |alias: &str| -> Vec<Value> { nodes_of(response, alias).into_iter().filter_map(pr_item).collect() };
    let mine = items("mine");
    let review = items("review");
    let assigned = items("assigned");

    let is_cop = |v: &Value| v.get("isCopilot").and_then(Value::as_bool).unwrap_or(false);
    let to_review: Vec<Value> = review.iter().filter(|p| !is_cop(p)).cloned().collect();

    // Copilot's PRs reach you as an assignment or a review request: merge, once each.
    let mut copilot: Vec<Value> = Vec::new();
    for p in review.iter().chain(assigned.iter()).filter(|p| is_cop(p)) {
        let url = p.get("url").and_then(Value::as_str).unwrap_or("");
        if !copilot.iter().any(|c| c.get("url").and_then(Value::as_str) == Some(url)) {
            copilot.push(p.clone());
        }
    }
    let reviewed_mine = mine
        .iter()
        .filter(|p| p.get("copilotReviewed").and_then(Value::as_bool).unwrap_or(false))
        .count();
    json!({
        "mine": mine,
        "toReview": to_review,
        "copilot": copilot,
        "copilotReviewedMine": reviewed_mine,
        "repos": repos_of(response),
        "calendar": calendar_of(response),
    })
}

fn urls_where(list: &Value, pred: impl Fn(&Value) -> bool) -> String {
    let mut urls: Vec<String> = list
        .as_array()
        .map(|a| a.iter().filter(|p| pred(p)).filter_map(|p| p.get("url").and_then(Value::as_str).map(str::to_string)).collect())
        .unwrap_or_default();
    urls.sort();
    urls.join(" ")
}

/// What changed since the last poll worth a badge, most important first: a CI
/// failure on one of my PRs, a review asked of me, then anything from Copilot.
/// The first poll after launch only fills the card.
fn pulse_event(pulse: &Value) -> Option<IntegrationEvent> {
    forge_event("github", pulse)
}

/// `pulse_event` for any forge: `forge` keeps each one's memory apart, so
/// GitHub's news never hides GitLab's (or Gitea's).
fn forge_event(forge: &str, pulse: &Value) -> Option<IntegrationEvent> {
    let first = |key: &str| pulse.get(key).and_then(|v| v.get(0)).cloned();
    let title = |p: &Option<Value>| p.as_ref().and_then(|p| p.get("title")).and_then(Value::as_str).map(str::to_string);

    // Always asks (so the memory follows the list down to empty and back), but
    // only an actual set of items can be news.
    let key = |what: &str| format!("{forge}_{what}");
    let fresh = |what: &str, ids: &str| is_new(&key(what), ids) && !ids.is_empty();

    let failing = urls_where(&pulse["mine"], |p| p.get("ci").and_then(Value::as_str) == Some("failure"));
    let fresh_failure = fresh("ci_failed", &failing);
    let review_id = urls_where(&pulse["toReview"], |_| true);
    let fresh_review = fresh("review", &review_id);
    let copilot_prs = urls_where(&pulse["copilot"], |_| true);
    let fresh_copilot_pr = fresh("copilot_pr", &copilot_prs);
    let copilot_reviews = urls_where(&pulse["mine"], |p| p.get("copilotReviewed").and_then(Value::as_bool).unwrap_or(false));
    let fresh_copilot_review = fresh("copilot_review", &copilot_reviews);

    if fresh_failure {
        let p = pulse["mine"].as_array()?.iter().find(|p| p.get("ci").and_then(Value::as_str) == Some("failure")).cloned();
        return Some(IntegrationEvent { success: false, label: "Falló el CI".into(), detail: title(&p) });
    }
    // A default branch's CI: red is news, and so is green again after red.
    let red_repos = urls_where(&pulse["repos"], |p| p.get("ci").and_then(Value::as_str) == Some("failure"));
    let repo_changed = is_new(&key("branch_ci"), &red_repos);
    if repo_changed && !red_repos.is_empty() {
        let name = pulse["repos"]
            .as_array()
            .and_then(|l| l.iter().find(|p| p.get("ci").and_then(Value::as_str) == Some("failure")))
            .and_then(|p| p.get("name").and_then(Value::as_str))
            .map(str::to_string);
        return Some(IntegrationEvent { success: false, label: "Falló el CI de la rama principal".into(), detail: name });
    }
    if fresh_review {
        let p = first("toReview");
        return Some(IntegrationEvent { success: true, label: "Revisión pedida".into(), detail: title(&p) });
    }
    if fresh_copilot_pr {
        let p = first("copilot");
        return Some(IntegrationEvent { success: true, label: "Copilot abrió un pull request".into(), detail: title(&p) });
    }
    if repo_changed && red_repos.is_empty() {
        return Some(IntegrationEvent { success: true, label: "El CI de la rama principal vuelve a estar en verde".into(), detail: None });
    }
    if fresh_copilot_review {
        let p = pulse["mine"].as_array()?.iter().find(|p| p.get("copilotReviewed").and_then(Value::as_bool) == Some(true)).cloned();
        return Some(IntegrationEvent { success: true, label: "Copilot revisó tu PR".into(), detail: title(&p) });
    }
    None
}

async fn poll_github(app: AppHandle) {
    let Some(token) = secrets::get("github-token") else { return };
    let http = client();

    let user = http
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Coucou")
        .send()
        .await;
    let Ok(response) = user else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_github",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), "Al token le falta el permiso necesario")),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let public = json.get("public_repos").and_then(Value::as_i64).unwrap_or(0);
    let private = json
        .get("owned_private_repos")
        .or_else(|| json.get("total_private_repos"))
        .and_then(Value::as_i64)
        .unwrap_or(0);

    let repos = http
        .get("https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=pushed")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Coucou")
        .send()
        .await;
    let stars: i64 = match repos {
        Ok(r) if r.status().is_success() => r
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|list| {
                list.iter()
                    .filter_map(|r| r.get("stargazers_count").and_then(Value::as_i64))
                    .sum()
            })
            .unwrap_or(0),
        _ => 0,
    };

    let login = json.get("login").and_then(Value::as_str).unwrap_or("").to_string();

    // Pull requests, CI and Copilot — one GraphQL request. Failing here (a token
    // without access to pull requests) leaves the repository stats intact.
    let mut pulse = Value::Null;
    let mut pulse_error = Value::Null;
    let answer = http
        .post("https://api.github.com/graphql")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "Coucou")
        .json(&json!({ "query": GITHUB_PULSE_QUERY }))
        .send()
        .await;
    match answer {
        Ok(r) if r.status().is_success() => {
            let body: Value = r.json().await.unwrap_or(Value::Null);
            if body.get("data").map(|d| d.is_object()).unwrap_or(false) {
                pulse = parse_pulse(&body);
            } else {
                let why = body
                    .pointer("/errors/0/message")
                    .and_then(Value::as_str)
                    .unwrap_or("GitHub rechazó la consulta de pull requests");
                pulse_error = json!(why);
            }
        }
        Ok(r) => pulse_error = json!(status_error(r.status().as_u16(), "El token no puede leer pull requests")),
        Err(_) => {}
    }
    let event = if pulse.is_object() { pulse_event(&pulse) } else { None };

    emit(&app, IntegrationUpdate {
        id: "integration_github",
        data: json!({
            "totalRepos": public + private,
            "totalStars": stars,
            "login": login,
            "pulse": pulse,
            "pulseError": pulse_error,
        }),
        error: None,
        event,
    });
}

// ── GitLab and Gitea ──────────────────────────────────────────────────────────
//
// Two pills like GitHub's, for gitlab.com or your own instance: open merge and
// pull requests, reviews asked of you, the default branch's CI and your
// activity. Each sends the same `pulse` the GitHub card reads (without Copilot),
// so the island draws them with the same card. From the original Coucou's
// Windows 0.5.2 (#831).

/// The instance's address from the credential store (`gitlab-url`, `gitea-url`),
/// or `fallback`. Only http(s) with a host, without a trailing slash.
fn forge_base(key: &str, fallback: Option<&str>) -> Option<String> {
    let raw = secrets::get(key).filter(|v| !v.trim().is_empty()).or_else(|| fallback.map(str::to_string))?;
    let raw = raw.trim().trim_matches(|c| c == '"' || c == '\'');
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let parsed = reqwest::Url::parse(&with_scheme).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return None;
    }
    Some(parsed.as_str().trim_end_matches('/').to_string())
}

/// The token goes to the instance the person typed, never to wherever it redirects.
fn forge_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default()
}

/// Gregorian date and Sunday-based weekday (0 = Sunday) of a day counted from 1970-01-01.
fn civil_day(day: i64) -> (i64, u32, u32, u8) {
    let z = day + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = yoe + era * 400 + i64::from(m <= 2);
    (year, m as u32, d as u32, (day + 4).rem_euclid(7) as u8)
}

fn date_key(day: i64) -> String {
    let (y, m, d, _) = civil_day(day);
    format!("{y:04}-{m:02}-{d:02}")
}

fn today() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86_400)
        .unwrap_or(0)
}

/// Contributions per day ("YYYY-MM-DD") → the calendar the GitHub card draws:
/// the year's total, and the last 22 weeks as levels 0-4, a column per week
/// starting on Sunday (like GitHub's).
fn forge_calendar(counts: &std::collections::HashMap<String, i64>, today: i64) -> Value {
    let total: i64 = (today - 364..=today).map(|d| counts.get(&date_key(d)).copied().unwrap_or(0)).sum();
    let start = today - i64::from(civil_day(today).3) - 21 * 7;
    let mut weeks: Vec<Vec<u8>> = Vec::new();
    for day in start..=today {
        if civil_day(day).3 == 0 || weeks.is_empty() {
            weeks.push(Vec::new());
        }
        let n = counts.get(&date_key(day)).copied().unwrap_or(0);
        let level = match n {
            i64::MIN..=0 => 0,
            1 => 1,
            2..=3 => 2,
            4..=7 => 3,
            _ => 4,
        };
        weeks.last_mut().unwrap().push(level);
    }
    json!({ "total": total, "weeks": weeks })
}

fn forge_pr(repo: &str, number: i64, title: &str, url: &str, draft: bool, ci: &str) -> Value {
    json!({
        "number": number, "title": if title.is_empty() { "(untitled)" } else { title }, "url": url, "repo": repo,
        "isDraft": draft, "reviewDecision": "", "ci": ci, "author": "",
        "isCopilot": false, "copilotReviewed": false, "updatedAt": "",
    })
}

fn forge_pulse(mine: Vec<Value>, to_review: Vec<Value>, repos: Vec<Value>, calendar: Value) -> Value {
    json!({
        "mine": mine, "toReview": to_review, "copilot": [], "copilotReviewedMine": 0,
        "repos": repos, "calendar": calendar,
    })
}

fn gitlab_ci(status: Option<&str>) -> Option<&'static str> {
    match status? {
        "success" => Some("success"),
        "failed" | "canceled" => Some("failure"),
        "running" | "pending" | "created" | "preparing" | "waiting_for_resource" | "scheduled" => Some("pending"),
        _ => None,
    }
}

/// A GitLab merge request as the card needs it. Its project comes from
/// `references.full` ("group/project!12").
fn gitlab_mr(mr: &Value) -> Option<Value> {
    let full = mr.pointer("/references/full").and_then(Value::as_str)?;
    let repo = full.rsplit_once('!').map(|(r, _)| r).unwrap_or(full);
    let ci = gitlab_ci(mr.pointer("/head_pipeline/status").and_then(Value::as_str)).unwrap_or("unknown");
    Some(forge_pr(
        repo,
        mr.get("iid").and_then(Value::as_i64)?,
        mr.get("title").and_then(Value::as_str).unwrap_or(""),
        mr.get("web_url").and_then(Value::as_str)?,
        mr.get("draft").or_else(|| mr.get("work_in_progress")).and_then(Value::as_bool).unwrap_or(false),
        ci,
    ))
}

fn gitlab_counts(events: &[Value]) -> std::collections::HashMap<String, i64> {
    let mut counts = std::collections::HashMap::new();
    for e in events {
        if let Some(date) = e.get("created_at").and_then(Value::as_str).and_then(|s| s.get(..10)) {
            *counts.entry(date.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

async fn forge_list(request: reqwest::RequestBuilder) -> Vec<Value> {
    match request.send().await {
        Ok(r) if r.status().is_success() => r.json::<Vec<Value>>().await.unwrap_or_default(),
        _ => Vec::new(),
    }
}

async fn poll_gitlab(app: AppHandle) {
    let Some(token) = secrets::get("gitlab-token") else { return };
    let Some(base) = forge_base("gitlab-url", Some("https://gitlab.com")) else {
        emit(&app, IntegrationUpdate { id: "integration_gitlab", data: json!({}), error: Some("La dirección de GitLab no es válida".into()), event: None });
        return;
    };
    let http = forge_client();
    let get = |path: String| http.get(format!("{base}/api/v4{path}")).header("PRIVATE-TOKEN", &token);

    let Ok(user) = get("/user".into()).send().await else { return };
    if !user.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_gitlab",
            data: json!({}),
            error: Some(status_error(user.status().as_u16(), "Al token le falta el permiso read_api")),
            event: None,
        });
        return;
    }
    let user: Value = user.json().await.unwrap_or(json!({}));
    let login = user.get("username").and_then(Value::as_str).unwrap_or("").to_string();

    // The projects you own, most recently active first: their count and stars,
    // and the first ten's default-branch CI.
    let mut projects = Vec::new();
    for page in 1..=5 {
        let batch = forge_list(get(format!("/projects?owned=true&simple=true&order_by=last_activity_at&per_page=100&page={page}"))).await;
        let done = batch.len() < 100;
        projects.extend(batch);
        if done {
            break;
        }
    }
    let stars: i64 = projects.iter().filter_map(|p| p.get("star_count").and_then(Value::as_i64)).sum();
    let mut repos = Vec::new();
    for p in projects.iter().take(10) {
        let (Some(id), Some(name), Some(url)) = (
            p.get("id").and_then(Value::as_i64),
            p.get("path_with_namespace").and_then(Value::as_str),
            p.get("web_url").and_then(Value::as_str),
        ) else { continue };
        let Some(branch) = p.get("default_branch").and_then(Value::as_str) else { continue };
        let pipelines = forge_list(get(format!("/projects/{id}/pipelines?per_page=1&ref={}", urlencode(branch)))).await;
        if let Some(ci) = gitlab_ci(pipelines.first().and_then(|p| p.get("status")).and_then(Value::as_str)) {
            repos.push(json!({ "name": name, "url": format!("{url}/-/pipelines"), "branch": branch, "ci": ci }));
        }
    }

    let mine: Vec<Value> = forge_list(get("/merge_requests?scope=created_by_me&state=opened&per_page=20".into()))
        .await.iter().filter_map(gitlab_mr).collect();
    let to_review: Vec<Value> = if login.is_empty() {
        Vec::new()
    } else {
        forge_list(get(format!("/merge_requests?scope=all&state=opened&reviewer_username={}&per_page=20", urlencode(&login))))
            .await.iter().filter_map(gitlab_mr).collect()
    };

    let now = today();
    let after = date_key(now - 366);
    let mut events = Vec::new();
    for page in 1..=10 {
        let batch = forge_list(get(format!("/events?after={after}&per_page=100&page={page}"))).await;
        let done = batch.len() < 100;
        events.extend(batch);
        if done {
            break;
        }
    }

    let pulse = forge_pulse(mine, to_review, repos, forge_calendar(&gitlab_counts(&events), now));
    let event = forge_event("gitlab", &pulse);
    let user_q = urlencode(&login);
    emit(&app, IntegrationUpdate {
        id: "integration_gitlab",
        data: json!({
            "totalRepos": projects.len(),
            "totalStars": stars,
            "login": login,
            "pulse": pulse,
            "pulseError": Value::Null,
            "links": {
                "home": user.get("web_url").and_then(Value::as_str).unwrap_or(&base),
                "mine": format!("{base}/dashboard/merge_requests?author_username={user_q}"),
                "review": format!("{base}/dashboard/merge_requests?reviewer_username={user_q}"),
            },
        }),
        error: None,
        event,
    });
}

fn gitea_ci(state: Option<&str>) -> Option<&'static str> {
    match state? {
        "success" => Some("success"),
        "failure" | "error" => Some("failure"),
        "pending" => Some("pending"),
        _ => None,
    }
}

fn gitea_pr(issue: &Value) -> Option<Value> {
    Some(forge_pr(
        issue.pointer("/repository/full_name").and_then(Value::as_str)?,
        issue.get("number").and_then(Value::as_i64)?,
        issue.get("title").and_then(Value::as_str).unwrap_or(""),
        issue.get("html_url").and_then(Value::as_str)?,
        issue.pointer("/pull_request/draft").and_then(Value::as_bool).unwrap_or(false),
        "unknown",
    ))
}

/// Gitea's heatmap (a timestamp in seconds per bucket) as contributions per day.
fn gitea_counts(heatmap: &[Value]) -> std::collections::HashMap<String, i64> {
    let mut counts = std::collections::HashMap::new();
    for entry in heatmap {
        let Some(ts) = entry.get("timestamp").and_then(Value::as_i64) else { continue };
        let day = if ts > 10_000_000_000 { ts / 86_400_000 } else { ts / 86_400 };
        let n = entry.get("contributions").and_then(Value::as_i64).unwrap_or(0).max(0);
        *counts.entry(date_key(day)).or_insert(0) += n;
    }
    counts
}

async fn poll_gitea(app: AppHandle) {
    let Some(token) = secrets::get("gitea-token") else { return };
    let Some(base) = forge_base("gitea-url", None) else {
        emit(&app, IntegrationUpdate { id: "integration_gitea", data: json!({}), error: Some("Falta la dirección de tu Gitea".into()), event: None });
        return;
    };
    let http = forge_client();
    let get = |path: String| http.get(format!("{base}/api/v1{path}")).header("Authorization", format!("token {token}"));

    let Ok(user) = get("/user".into()).send().await else { return };
    if !user.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_gitea",
            data: json!({}),
            error: Some(status_error(user.status().as_u16(), "Al token le falta el permiso de lectura")),
            event: None,
        });
        return;
    }
    let user: Value = user.json().await.unwrap_or(json!({}));
    let login = user.get("login").and_then(Value::as_str).unwrap_or("").to_string();

    let owned: Vec<Value> = forge_list(get("/user/repos?limit=50".into()))
        .await
        .into_iter()
        .filter(|r| r.pointer("/owner/login").and_then(Value::as_str) == Some(login.as_str()))
        .collect();
    let stars: i64 = owned.iter().filter_map(|r| r.get("stars_count").and_then(Value::as_i64)).sum();
    let mut repos = Vec::new();
    for r in owned.iter().take(10) {
        let (Some(name), Some(url)) = (r.get("full_name").and_then(Value::as_str), r.get("html_url").and_then(Value::as_str)) else { continue };
        let branch = r.get("default_branch").and_then(Value::as_str).unwrap_or("main");
        let status: Value = match get(format!("/repos/{name}/commits/{}/status", urlencode(branch))).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.unwrap_or(Value::Null),
            _ => Value::Null,
        };
        if status.get("total_count").and_then(Value::as_i64).unwrap_or(0) == 0 {
            continue;
        }
        if let Some(ci) = gitea_ci(status.get("state").and_then(Value::as_str)) {
            repos.push(json!({ "name": name, "url": format!("{url}/actions"), "branch": branch, "ci": ci }));
        }
    }

    let mine: Vec<Value> = forge_list(get("/repos/issues/search?type=pulls&state=open&created=true&limit=20".into()))
        .await.iter().filter_map(gitea_pr).collect();
    let to_review: Vec<Value> = forge_list(get("/repos/issues/search?type=pulls&state=open&review_requested=true&limit=20".into()))
        .await.iter().filter_map(gitea_pr).collect();
    let heatmap = if login.is_empty() { Vec::new() } else { forge_list(get(format!("/users/{}/heatmap", urlencode(&login)))).await };

    let pulse = forge_pulse(mine, to_review, repos, forge_calendar(&gitea_counts(&heatmap), today()));
    let event = forge_event("gitea", &pulse);
    emit(&app, IntegrationUpdate {
        id: "integration_gitea",
        data: json!({
            "totalRepos": owned.len(),
            "totalStars": stars,
            "login": login,
            "pulse": pulse,
            "pulseError": Value::Null,
            "links": {
                "home": format!("{base}/{}", urlencode(&login)),
                "mine": format!("{base}/pulls?type=created_by"),
                "review": format!("{base}/pulls?type=review_requested"),
            },
        }),
        error: None,
        event,
    });
}

/// Percent-encodes a path or query piece (a branch like `release/1.0`, a login).
fn urlencode(raw: &str) -> String {
    raw.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ── Vercel ────────────────────────────────────────────────────────────────────

async fn poll_vercel(app: AppHandle) {
    let Some(token) = secrets::get("vercel-token") else { return };
    let response = client()
        .get("https://api.vercel.com/v6/deployments?limit=5")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_vercel",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), "Al token le falta acceso")),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let terminal = ["READY", "ERROR", "CANCELED"];
    let deployments: Vec<Value> = json
        .get("deployments")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|d| {
                    let state = d.get("state")?.as_str()?;
                    if !terminal.contains(&state) {
                        return None;
                    }
                    let meta = d.get("meta");
                    let pick = |keys: [&str; 3]| {
                        meta.and_then(|m| keys.iter().find_map(|k| m.get(*k).and_then(Value::as_str)))
                            .map(str::to_string)
                    };
                    Some(json!({
                        "id": d.get("uid")?.as_str()?,
                        "projectName": d.get("name")?.as_str()?,
                        "url": d.get("url").and_then(Value::as_str).unwrap_or(""),
                        "state": state,
                        "createdAt": d.get("createdAt").and_then(Value::as_f64).unwrap_or(0.0),
                        "commitMessage": pick(["githubCommitMessage", "gitlabCommitMessage", "bitbucketCommitMessage"]),
                        "branch": pick(["githubCommitRef", "gitlabCommitRef", "bitbucketBranch"]),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    let event = deployments.first().and_then(|latest| {
        let id = latest.get("id")?.as_str()?;
        if !is_new("vercel", id) {
            return None;
        }
        let success = latest.get("state")?.as_str()? == "READY";
        Some(IntegrationEvent {
            success,
            label: latest.get("projectName")?.as_str()?.to_string(),
            detail: None,
        })
    });

    emit(&app, IntegrationUpdate {
        id: "integration_vercel",
        data: json!({ "deployments": deployments }),
        error: None,
        event,
    });
}

// ── Resend ────────────────────────────────────────────────────────────────────

async fn poll_resend(app: AppHandle) {
    let Some(key) = secrets::get("resend-api-key") else { return };
    let response = client()
        .get("https://api.resend.com/emails?limit=100")
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_resend",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), "Key lacks access")),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let total = json
        .get("total")
        .or_else(|| json.get("count"))
        .and_then(Value::as_i64);
    let emails: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .take(5)
                .filter_map(|e| {
                    let to = match e.get("to") {
                        Some(Value::Array(a)) => a.clone(),
                        Some(Value::String(s)) => vec![Value::String(s.clone())],
                        _ => vec![],
                    };
                    Some(json!({
                        "id": e.get("id")?.as_str()?,
                        "to": to,
                        "subject": e.get("subject").and_then(Value::as_str).unwrap_or(""),
                        "createdAt": e.get("created_at").and_then(Value::as_str).unwrap_or(""),
                        "lastEvent": e.get("last_event").and_then(Value::as_str).unwrap_or(""),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_resend",
        data: json!({ "emails": emails, "total": total }),
        error: None,
        event: None,
    });
}

// ── Notion ────────────────────────────────────────────────────────────────────

async fn poll_notion(app: AppHandle) {
    let Some(token) = secrets::get("notion-api-key") else { return };
    let response = client()
        .post("https://api.notion.com/v1/search")
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", "2022-06-28")
        .header("Content-Type", "application/json")
        .json(&json!({
            "sort": { "direction": "descending", "timestamp": "last_edited_time" },
            "page_size": 3
        }))
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_notion",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), "A la integración le falta acceso")),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let pages: Vec<Value> = json
        .get("results")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(parse_notion_page).collect())
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_notion",
        data: json!({ "pages": pages }),
        error: None,
        event: None,
    });
}

fn parse_notion_page(obj: &Value) -> Option<Value> {
    let id = obj.get("id")?.as_str()?;
    let is_database = obj.get("object").and_then(Value::as_str) == Some("database");

    let mut title = "Untitled".to_string();
    if is_database {
        if let Some(text) = obj
            .get("title")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|t| t.get("plain_text"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                title = text.to_string();
            }
        }
    } else if let Some(props) = obj.get("properties").and_then(Value::as_object) {
        for prop in props.values() {
            if prop.get("type").and_then(Value::as_str) != Some("title") {
                continue;
            }
            if let Some(text) = prop
                .get("title")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(|t| t.get("plain_text"))
                .and_then(Value::as_str)
            {
                if !text.is_empty() {
                    title = text.to_string();
                    break;
                }
            }
        }
    }

    let emoji = obj
        .get("icon")
        .filter(|i| i.get("type").and_then(Value::as_str) == Some("emoji"))
        .and_then(|i| i.get("emoji"))
        .and_then(Value::as_str);

    Some(json!({
        "id": id,
        "title": title,
        "emoji": emoji,
        "lastEditedAt": obj.get("last_edited_time").and_then(Value::as_str)?,
        "url": obj.get("url").and_then(Value::as_str).unwrap_or("https://notion.so"),
    }))
}

// ── Cal.com ───────────────────────────────────────────────────────────────────

async fn poll_calcom(app: AppHandle) {
    let Some(key) = secrets::get("calcom-api-key") else { return };
    let response = client()
        .get("https://api.cal.com/v2/bookings?status=upcoming")
        .header("Authorization", format!("Bearer {key}"))
        .header("cal-api-version", "2024-08-13")
        .send()
        .await;
    let Ok(response) = response else { return };
    if !response.status().is_success() {
        emit(&app, IntegrationUpdate {
            id: "integration_calcom",
            data: json!({}),
            error: Some(status_error(response.status().as_u16(), "Key lacks access")),
            event: None,
        });
        return;
    }
    let json: Value = response.json().await.unwrap_or(json!({}));
    let bookings: Vec<Value> = json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|b| {
                    let start = b
                        .get("start")
                        .or_else(|| b.get("startTime"))
                        .and_then(Value::as_str)?;
                    let attendee = b.get("attendees").and_then(Value::as_array).and_then(|a| a.first());
                    let notes = b
                        .get("responses")
                        .and_then(|r| r.get("notes"))
                        .and_then(|n| n.get("value"))
                        .and_then(Value::as_str)
                        .or_else(|| b.get("description").and_then(Value::as_str))
                        .filter(|s| !s.is_empty());
                    Some(json!({
                        "id": b.get("id").map(|v| v.to_string()).unwrap_or_default(),
                        "title": b.get("title").and_then(Value::as_str).unwrap_or("Meeting"),
                        "start": start,
                        "status": b.get("status").and_then(Value::as_str).unwrap_or("accepted"),
                        "attendeeName": attendee.and_then(|a| a.get("name")).and_then(Value::as_str),
                        "attendeeEmail": attendee.and_then(|a| a.get("email")).and_then(Value::as_str),
                        "attendeeNotes": notes,
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    emit(&app, IntegrationUpdate {
        id: "integration_calcom",
        data: json!({ "bookings": bookings }),
        error: None,
        event: None,
    });
}

#[cfg(test)]
mod github_tests {
    use super::*;

    fn pr(number: i64, author: &str, ci: &str, reviewers: &[&str]) -> Value {
        json!({
            "number": number, "title": format!("PR {number}"), "url": format!("https://github.com/o/r/pull/{number}"),
            "isDraft": false, "reviewDecision": null, "updatedAt": "2026-10-05T10:00:00Z",
            "author": { "login": author, "__typename": "User" },
            "repository": { "nameWithOwner": "o/r" },
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": ci } } }] },
            "reviews": { "nodes": reviewers.iter().map(|r| json!({ "state": "COMMENTED", "author": { "login": r } })).collect::<Vec<_>>() },
        })
    }

    fn answer(mine: Vec<Value>, review: Vec<Value>, assigned: Vec<Value>) -> Value {
        json!({ "data": {
            "mine": { "nodes": mine }, "review": { "nodes": review }, "assigned": { "nodes": assigned },
        } })
    }

    fn viewer_answer() -> Value {
        json!({ "data": { "viewer": {
            "repositories": { "nodes": [
                { "nameWithOwner": "me/app", "url": "https://github.com/me/app",
                  "defaultBranchRef": { "name": "main", "target": { "statusCheckRollup": { "state": "FAILURE" } } } },
                { "nameWithOwner": "me/lib", "url": "https://github.com/me/lib",
                  "defaultBranchRef": { "name": "trunk", "target": { "statusCheckRollup": { "state": "SUCCESS" } } } },
                { "nameWithOwner": "me/no-ci", "url": "https://github.com/me/no-ci",
                  "defaultBranchRef": { "name": "main", "target": { "statusCheckRollup": null } } },
                { "nameWithOwner": "me/empty", "url": "https://github.com/me/empty", "defaultBranchRef": null },
                "junk"
            ] },
            "contributionsCollection": { "contributionCalendar": {
                "totalContributions": 123,
                "weeks": [
                    { "contributionDays": [ { "contributionCount": 0, "contributionLevel": "NONE" },
                                            { "contributionCount": 3, "contributionLevel": "SECOND_QUARTILE" } ] },
                    { "contributionDays": [ { "contributionCount": 9, "contributionLevel": "FOURTH_QUARTILE" } ] }
                ]
            } }
        } } })
    }

    #[test]
    fn default_branch_ci_is_listed_and_repos_without_ci_are_left_out() {
        let repos = repos_of(&viewer_answer());
        let names: Vec<&str> = repos.iter().map(|r| r["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["me/app", "me/lib"]);
        assert_eq!(repos[0]["ci"], "failure");
        assert_eq!(repos[1]["branch"], "trunk");
        assert!(repos_of(&json!({})).is_empty());
    }

    #[test]
    fn the_calendar_becomes_levels_by_week() {
        let c = calendar_of(&viewer_answer()).unwrap();
        assert_eq!(c["total"], 123);
        assert_eq!(c["weeks"], json!([[0, 2], [4]]));
        assert!(calendar_of(&json!({ "data": {} })).is_none());
    }

    #[test]
    fn a_long_calendar_keeps_only_the_last_weeks() {
        let weeks: Vec<Value> = (0..53).map(|_| json!({ "contributionDays": [ { "contributionLevel": "FIRST_QUARTILE" } ] })).collect();
        let c = calendar_of(&json!({ "data": { "viewer": { "contributionsCollection": { "contributionCalendar": {
            "totalContributions": 1, "weeks": weeks } } } } })).unwrap();
        assert_eq!(c["weeks"].as_array().unwrap().len(), 22);
    }

    #[test]
    fn copilot_work_is_listed_apart_from_reviews_asked_of_you() {
        let r = answer(
            vec![pr(1, "jaime", "SUCCESS", &["copilot-pull-request-reviewer"]), pr(2, "jaime", "FAILURE", &[])],
            vec![pr(10, "colleague", "PENDING", &[]), pr(11, "Copilot", "SUCCESS", &[])],
            vec![pr(11, "Copilot", "SUCCESS", &[]), pr(12, "copilot-swe-agent", "FAILURE", &[])],
        );
        let p = parse_pulse(&r);
        // A colleague's PR is a review for you; Copilot's are not.
        assert_eq!(p["toReview"].as_array().unwrap().len(), 1);
        assert_eq!(p["toReview"][0]["number"], 10);
        // Copilot's PRs reach you twice (review request and assignment): listed once.
        let copilot: Vec<i64> = p["copilot"].as_array().unwrap().iter().map(|x| x["number"].as_i64().unwrap()).collect();
        assert_eq!(copilot, vec![11, 12]);
        // Copilot reviewed one of mine, and CI is read per PR.
        assert_eq!(p["copilotReviewedMine"], 1);
        assert_eq!(p["mine"][0]["copilotReviewed"], true);
        assert_eq!(p["mine"][0]["ci"], "success");
        assert_eq!(p["mine"][1]["ci"], "failure");
        assert_eq!(p["toReview"][0]["ci"], "pending");
    }

    #[test]
    fn a_pr_with_no_checks_or_reviews_still_parses() {
        let node = json!({ "url": "https://github.com/o/r/pull/3", "number": 3, "title": "Bare", "commits": { "nodes": [] }, "reviews": { "nodes": [] } });
        let item = pr_item(&node).unwrap();
        assert_eq!(item["ci"], "unknown");
        assert_eq!(item["copilotReviewed"], false);
        assert_eq!(item["isCopilot"], false);
        // Something that is not a PR (no url) is skipped.
        assert!(pr_item(&json!({ "number": 4 })).is_none());
        // An answer with errors and no data parses to nothing, never panics.
        let empty = parse_pulse(&json!({ "errors": [{ "message": "nope" }] }));
        assert_eq!(empty["mine"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn the_first_poll_is_silent_and_then_each_kind_of_news_fires_once() {
        let first = parse_pulse(&answer(vec![pr(1, "me", "SUCCESS", &[])], vec![pr(10, "colleague", "PENDING", &[])], vec![]));
        assert!(pulse_event(&first).is_none(), "the first poll only fills the card");
        assert!(pulse_event(&first).is_none(), "nothing changed");

        // A new review request.
        let review = parse_pulse(&answer(vec![pr(1, "me", "SUCCESS", &[])], vec![pr(10, "colleague", "PENDING", &[]), pr(13, "other", "PENDING", &[])], vec![]));
        let e = pulse_event(&review).expect("a new review request is news");
        assert_eq!(e.label, "Revisión pedida");
        assert!(e.success);
        assert!(pulse_event(&review).is_none(), "and only once");

        // CI failing on mine outranks everything.
        let failing = parse_pulse(&answer(vec![pr(1, "me", "FAILURE", &[])], vec![pr(10, "colleague", "PENDING", &[]), pr(13, "other", "PENDING", &[]), pr(14, "x", "PENDING", &[])], vec![pr(20, "Copilot", "SUCCESS", &[])]));
        let e = pulse_event(&failing).unwrap();
        assert_eq!(e.label, "Falló el CI");
        assert!(!e.success);
        // One badge per cycle: the most important. The rest of what arrived with
        // it (a review request, a Copilot PR) stays in the card, not a second badge.
        assert!(pulse_event(&failing).is_none());

        // A Copilot PR on its own is news.
        let copilot = parse_pulse(&answer(vec![pr(1, "me", "SUCCESS", &[])], vec![pr(10, "colleague", "PENDING", &[]), pr(13, "other", "PENDING", &[]), pr(14, "x", "PENDING", &[])], vec![pr(20, "Copilot", "SUCCESS", &[]), pr(21, "Copilot", "PENDING", &[])]));
        assert_eq!(pulse_event(&copilot).unwrap().label, "Copilot abrió un pull request");
    }
}

#[cfg(test)]
mod forge_tests {
    use super::*;

    #[test]
    fn civil_days_are_gregorian_dates_with_their_weekday() {
        assert_eq!(civil_day(0), (1970, 1, 1, 4));
        assert_eq!(date_key(19_723), "2024-01-01");
        assert_eq!(civil_day(19_723).3, 1, "1 January 2024 was a Monday");
        assert_eq!(date_key(19_782), "2024-02-29");
    }

    #[test]
    fn a_forge_calendar_has_sunday_columns_and_counts_the_year() {
        let today = 19_723; // a Monday
        let mut counts = std::collections::HashMap::new();
        counts.insert(date_key(today), 9);
        counts.insert(date_key(today - 300), 2);
        counts.insert(date_key(today - 400), 50); // more than a year ago
        let cal = forge_calendar(&counts, today);
        assert_eq!(cal["total"], 11);
        let weeks = cal["weeks"].as_array().unwrap();
        assert_eq!(weeks.len(), 22);
        assert!(weeks[..21].iter().all(|w| w.as_array().unwrap().len() == 7));
        let last = weeks[21].as_array().unwrap();
        assert_eq!(last.len(), 2, "Sunday and Monday");
        assert_eq!(last[1], 4);
    }

    #[test]
    fn gitlab_merge_requests_and_pipelines_become_the_github_shape() {
        let mr = json!({ "iid": 12, "title": "Fix", "web_url": "https://gitlab.com/g/p/-/merge_requests/12",
            "references": { "full": "g/p!12" }, "draft": true, "head_pipeline": { "status": "failed" } });
        let item = gitlab_mr(&mr).unwrap();
        assert_eq!((item["repo"].as_str(), item["number"].as_i64(), item["ci"].as_str()), (Some("g/p"), Some(12), Some("failure")));
        assert_eq!(item["isDraft"], true);
        assert_eq!(gitlab_ci(Some("running")), Some("pending"));
        assert_eq!(gitlab_ci(Some("skipped")), None);
        let counts = gitlab_counts(&[json!({ "created_at": "2024-01-01T10:00:00Z" }), json!({ "created_at": "2024-01-01T23:00:00Z" })]);
        assert_eq!(counts["2024-01-01"], 2);
    }

    #[test]
    fn gitea_heatmap_takes_seconds_or_milliseconds() {
        let counts = gitea_counts(&[
            json!({ "timestamp": 19_723 * 86_400 + 3600, "contributions": 3 }),
            json!({ "timestamp": 19_723_i64 * 86_400_000, "contributions": 1 }),
        ]);
        assert_eq!(counts["2024-01-01"], 4);
        let pr = gitea_pr(&json!({ "number": 3, "title": "T", "html_url": "https://git.example/o/r/pulls/3",
            "repository": { "full_name": "o/r" }, "pull_request": { "draft": false } })).unwrap();
        assert_eq!(pr["repo"], "o/r");
    }

    #[test]
    fn each_forge_remembers_its_own_news() {
        let pulse = |url: &str| forge_pulse(Vec::new(), vec![forge_pr("o/r", 1, "Review me", url, false, "unknown")], Vec::new(), Value::Null);
        assert!(forge_event("test_forge_a", &pulse("https://a/1")).is_none(), "the first poll only fills the card");
        assert!(forge_event("test_forge_b", &pulse("https://a/1")).is_none(), "another forge has its own first poll");
        let news = forge_event("test_forge_a", &pulse("https://a/2")).unwrap();
        assert_eq!(news.label, "Revisión pedida");
    }

    #[test]
    fn urlencode_keeps_a_branch_one_path_piece() {
        assert_eq!(urlencode("release/1.0"), "release%2F1.0");
        assert_eq!(urlencode("main"), "main");
    }
}
