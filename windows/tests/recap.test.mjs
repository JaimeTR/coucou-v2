// Weekly recap: what a week of turns adds up to.
import test from "node:test";
import assert from "node:assert/strict";
import { RecapRecorder, weeklySummary, lastWeekStart, isoWeekKey, formatMinutes, minutesToday } from "../.test-build/island/recap.js";

const memory = () => {
  let saved = null;
  return { load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); }, get: () => saved };
};

test("last week starts on the previous Monday at midnight", () => {
  const monday = lastWeekStart(new Date(2026, 9, 7, 15)); // Wed 7 Oct 2026
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getDate(), 28); // Mon 28 Sep
  assert.equal(lastWeekStart(new Date(2026, 9, 5, 9)).getDate(), 28); // a Monday looks at the week before
  assert.equal(isoWeekKey(new Date(2026, 9, 7)), 202641);
  assert.equal(isoWeekKey(new Date(2027, 0, 1)), 202653);
});

test("turns are recorded from the hook events and summed by week", () => {
  const store = memory();
  let now = new Date(2026, 8, 29, 10).getTime(); // Tue 29 Sep, last week seen from 7 Oct
  const r = new RecapRecorder(store, () => now);
  r.prompt("s1", "integration_claude", "coucou");
  r.tool("s1", "Bash");
  r.tool("s1", "Read");
  r.diff("s1", "a.ts", 10, 2);
  r.diff("s1", "a.ts", 3, 1);
  r.diff("s1", "b.ts", 1, 0);
  now += 30 * 60000;
  r.stop("s1");
  // A parallel session on the same day: wall-clock time is not counted twice.
  now = new Date(2026, 8, 29, 10, 10).getTime();
  r.prompt("s2", "agent_gemini", "web");
  now += 10 * 60000;
  r.stop("s2");
  r.decision("integration_claude", "allow");
  r.decision("integration_claude", "deny");
  r.tool("unknown", "Bash"); // no turn open: ignored

  const s = weeklySummary(new RecapRecorder(store).data, new Date(2026, 9, 7, 9), { integration_claude: "Claude Code" });
  assert.equal(s.sessions, 2);
  assert.equal(s.minutes, 30);
  assert.equal(s.files, 2);
  assert.equal(s.added, 14);
  assert.equal(s.removed, 3);
  assert.equal(s.commands, 1);
  assert.equal(s.allowed, 1);
  assert.equal(s.denied, 1);
  assert.equal(s.topAgent, "Claude Code");
  assert.equal(s.busiestDay, 2);
  assert.equal(s.longestMinutes, 30);
});

test("an empty week has no recap; old turns are forgotten", () => {
  assert.equal(weeklySummary({ turns: [], decisions: [] }, new Date()), null);
  const store = memory();
  let now = Date.UTC(2026, 0, 1);
  const r = new RecapRecorder(store, () => now);
  r.prompt("s", "x", "p");
  r.stop("s");
  now += 13 * 7 * 86400000;
  r.decision("x", "allow");
  assert.equal(store.get().turns.length, 0);
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(200), "3h 20m");
});

test("today's minutes count only today, parallel work once", () => {
  const day = (h, m = 0) => new Date(2026, 9, 7, h, m).getTime();
  const turn = (start, end) => ({ pillId: "x", project: "p", start, end, files: 0, added: 0, removed: 0, commands: 0, questions: 0 });
  const data = { decisions: [], turns: [
    turn(day(9), day(10)),            // 60
    turn(day(9, 30), day(10, 30)),    // overlaps: 30 more
    turn(day(14), day(14, 20)),       // 20
    turn(new Date(2026, 9, 6, 22).getTime(), new Date(2026, 9, 6, 23).getTime()), // yesterday
  ] };
  assert.equal(minutesToday(data, new Date(2026, 9, 7, 16)), 110);
  assert.equal(minutesToday({ turns: [], decisions: [] }, new Date()), 0);
});
