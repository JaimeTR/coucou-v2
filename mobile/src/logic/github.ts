// GitHub and Copilot in one request: my open pull requests (with their CI), the
// reviews I was asked for, and what is assigned to me — which is where Copilot's
// coding agent puts its work. Same query and rules as the desktop app
// (windows/src-tauri/src/integrations.rs), so both tell the same story.

export const GITHUB_PULSE_QUERY = `
query {
  mine: search(query: "is:pr is:open author:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
  review: search(query: "is:pr is:open review-requested:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
  assigned: search(query: "is:pr is:open assignee:@me sort:updated-desc", type: ISSUE, first: 10) { nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url isDraft reviewDecision updatedAt
  author { login __typename }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  reviews(last: 30) { nodes { state author { login __typename } } }
}`;

export type Ci = "success" | "failure" | "pending" | "unknown";

export interface Pr {
  number: number;
  title: string;
  url: string;
  repo: string;
  isDraft: boolean;
  ci: Ci;
  author: string;
  isCopilot: boolean;
  copilotReviewed: boolean;
}

export interface Pulse {
  mine: Pr[];
  toReview: Pr[];
  copilot: Pr[];
  copilotReviewedMine: number;
}

type Json = Record<string, any>;

const isCopilot = (login: string) => login.toLowerCase().includes("copilot");

function ciOf(node: Json): Ci {
  switch (node?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "unknown";
  }
}

function prItem(node: Json): Pr | null {
  if (!node || typeof node.url !== "string") return null;
  const author: string = node.author?.login ?? "";
  const reviews: Json[] = Array.isArray(node.reviews?.nodes) ? node.reviews.nodes : [];
  return {
    number: Number(node.number) || 0,
    title: String(node.title ?? "(sin título)"),
    url: node.url,
    repo: String(node.repository?.nameWithOwner ?? ""),
    isDraft: node.isDraft === true,
    ci: ciOf(node),
    author,
    isCopilot: isCopilot(author),
    copilotReviewed: reviews.some((r) => isCopilot(String(r?.author?.login ?? ""))),
  };
}

const nodes = (response: Json, alias: string): Pr[] =>
  (Array.isArray(response?.data?.[alias]?.nodes) ? response.data[alias].nodes : [])
    .map(prItem)
    .filter((p: Pr | null): p is Pr => p !== null);

/** The GraphQL answer boiled down to what the screen shows. */
export function parsePulse(response: Json): Pulse {
  const mine = nodes(response, "mine");
  const review = nodes(response, "review");
  const assigned = nodes(response, "assigned");
  const copilot: Pr[] = [];
  for (const p of [...review, ...assigned].filter((x) => x.isCopilot)) {
    if (!copilot.some((c) => c.url === p.url)) copilot.push(p);
  }
  return {
    mine,
    toReview: review.filter((p) => !p.isCopilot),
    copilot,
    copilotReviewedMine: mine.filter((p) => p.copilotReviewed).length,
  };
}

export type Fetcher = (url: string, init?: Json) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class GithubError extends Error {}

export async function fetchPulse(token: string, fetcher: Fetcher): Promise<Pulse> {
  const response = await fetcher("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Coucou",
    },
    body: JSON.stringify({ query: GITHUB_PULSE_QUERY }),
  });
  if (response.status === 401) throw new GithubError("GitHub rechazó el token (401).");
  if (!response.ok) throw new GithubError(`GitHub respondió ${response.status}.`);
  const body = await response.json();
  if (!body?.data || typeof body.data !== "object") {
    throw new GithubError(String(body?.errors?.[0]?.message ?? "GitHub rechazó la consulta de pull requests"));
  }
  return parsePulse(body);
}

/** How many things need you, for the badge. */
export function attention(p: Pulse): { reviews: number; failing: number; copilot: number } {
  return {
    reviews: p.toReview.length,
    failing: p.mine.filter((x) => x.ci === "failure").length,
    copilot: p.copilot.length,
  };
}
