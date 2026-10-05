import { randomInt } from "node:crypto";
import type { CombinedReportView } from "./types.js";

type ClosingContext = Pick<CombinedReportView, "counts" | "oldest" | "unscanned">;

/** Choose once from the findings actually shown, then reuse the line for every output. */
export function chooseClosingLine(report: ClosingContext, draw: (limit: number) => number = randomInt): string {
  const { counts, oldest, unscanned } = report;
  let lines: readonly string[];
  if (counts.total === 0) {
    lines = unscanned.length
      ? [
        "Some corners of the graveyard remain unexplored.",
        "A few files are keeping their plot twists to themselves.",
        "The unscanned files have requested a little privacy.",
        "The scanner found locked doors. Very atmospheric.",
        "No verdict yet: some files are still behind the fog machine.",
      ]
      : [
        "Nothing surfaced in this view today.",
        "No ghosts in this view. For now.",
        "This view is suspiciously tidy.",
        "Even the tumbleweed took the day off.",
        "The graveyard is taking a tea break.",
      ];
  } else if ((oldest?.finding.ageDays ?? 0) >= 365) {
    lines = [
      "It's probably not temporary anymore.",
      "That relic is old enough to have its own TODOs.",
      "At this point, 'later' needs a calendar year.",
      "The dust has filed a change request.",
      "That one has survived more than one spring clean.",
    ];
  } else if (counts.categories.fossil >= Math.ceil(counts.total / 2)) {
    lines = [
      "These fossils are load-bearing now.",
      "The archaeologists have opened a pull request.",
      "At this point, the backlog needs carbon dating.",
      "Please do not feed the fossils.",
      "The backlog has entered its Jurassic period.",
    ];
  } else if (counts.total >= 10) {
    lines = [
      "The backlog brought friends.",
      "This is less a list and more a census.",
      "The backlog has formed a queue for the queue.",
      "The graveyard is requesting a second graveyard.",
      "Somewhere, a kanban board just sighed.",
    ];
  } else if (counts.branches > counts.code) {
    lines = [
      "These branches have started paying rent.",
      "Git says they're still here. Git is very literal.",
      "The branches are asking when the reunion is.",
      "One of these branches has packed for a long weekend.",
      "Branch management has become branch archaeology.",
    ];
  } else if (counts.code > counts.branches) {
    lines = [
      "Future you has left the chat.",
      "The TODOs have started a group chat.",
      "This comment has been promoted to documentation.",
      "The TODOs have unionised.",
      "The code left a note and moved out.",
    ];
  } else {
    lines = [
      "The graveyard has excellent attendance.",
      "A little haunted, but navigable.",
      "Everything is fine. The backlog disagrees.",
      "The code and the branches are comparing notes.",
      "One less ghost for another day.",
    ];
  }
  return lines[draw(lines.length)]!;
}
