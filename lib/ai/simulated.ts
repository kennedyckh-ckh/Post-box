import { SIMULATED_LABEL, type AiContent, type AiPoint, type AiProvider, type AiRequest, type AiResult } from "./types";

/**
 * A rule-based stand-in so the whole workflow can be tried without a language model. It does NOT understand text.
 * It groups entries by their tags and by group, quotes short pieces of them, and always cites the entries it used.
 * Everything it produces is labelled as a demo.
 */
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

export function simulate(req: AiRequest): AiContent {
  const ctx = req.context;
  if (!ctx || ctx.entries.length === 0) return { overview: `${SIMULATED_LABEL} There was nothing to analyse.`, points: [{ heading: "Not enough evidence", text: "No entries were available.", kind: "insufficient", cites: [] }] };
  const e = ctx.entries;
  const points: AiPoint[] = [];

  if (ctx.kind === "discussion_points") {
    const byTag = new Map<string, typeof e>();
    for (const x of e) for (const t of x.tags.length ? x.tags : ["(untagged)"]) byTag.set(t, [...(byTag.get(t) ?? []), x]);
    for (const [tag, list] of [...byTag].slice(0, 4)) {
      points.push({ heading: tag === "(untagged)" ? "Open question" : `About “${tag}”`, kind: "question", cites: list.slice(0, 3).map((x) => x.alias), text: `What might explain why several people wrote about “${clip(list[0].text, 60)}”, and what would someone who sees it differently say?` });
    }
    const groups = [...new Set(e.map((x) => x.groupLabel))];
    if (groups.length > 1) points.push({ heading: "Across groups", kind: "question", cites: groups.slice(0, 3).map((g) => e.find((x) => x.groupLabel === g)!.alias), text: `${groups.length} groups wrote about this. Where do their ideas differ, and what evidence would help decide between them?` });
    return { overview: `${SIMULATED_LABEL} Open-ended questions based on the tags and groups in the selected work.`, points };
  }

  if (ctx.kind === "cross_group") {
    const groups = [...new Set(e.map((x) => x.groupLabel))];
    for (const g of groups) {
      const list = e.filter((x) => x.groupLabel === g);
      points.push({ heading: `${g}`, kind: "theme", cites: list.slice(0, 3).map((x) => x.alias), text: `${g} wrote ${list.length} ${list.length === 1 ? "entry" : "entries"}. One example: “${clip(list[0].text)}”` });
    }
    const tagGroups = new Map<string, Set<string>>();
    for (const x of e) for (const t of x.tags) tagGroups.set(t, new Set([...(tagGroups.get(t) ?? []), x.groupLabel]));
    for (const [t, gs] of tagGroups) if (gs.size === 1) points.push({ heading: `Only ${[...gs][0]} used “${t}”`, kind: "minority", cites: e.filter((x) => x.tags.includes(t)).slice(0, 2).map((x) => x.alias), text: `Only one group used the tag “${t}”. This may be a difference in approach, or just that others did not tag it.` });
    return { overview: `${SIMULATED_LABEL} A rule-based comparison of ${groups.length} groups. It compares counts and tags, not meaning.`, points };
  }

  // group_summary
  const byTag = new Map<string, typeof e>();
  for (const x of e) for (const t of x.tags) byTag.set(t, [...(byTag.get(t) ?? []), x]);
  for (const [tag, list] of [...byTag].slice(0, 4)) points.push({ heading: `Tagged “${tag}”`, kind: "theme", cites: list.slice(0, 3).map((x) => x.alias), text: `${list.length} ${list.length === 1 ? "entry is" : "entries are"} tagged “${tag}”. For example: “${clip(list[0].text)}”` });
  const untagged = e.filter((x) => x.tags.length === 0);
  if (untagged.length) points.push({ heading: "Entries without a tag", kind: "theme", cites: untagged.slice(0, 3).map((x) => x.alias), text: `${untagged.length} ${untagged.length === 1 ? "entry has" : "entries have"} no tag. For example: “${clip(untagged[0].text)}”` });
  if (e.length < 3) points.push({ heading: "Limited evidence", kind: "insufficient", cites: [], text: `Only ${e.length} ${e.length === 1 ? "entry was" : "entries were"} available, which is not enough to say much about this group.` });
  return { overview: `${SIMULATED_LABEL} A rule-based summary of ${e.length} entries. It groups by tag and does not understand meaning.`, points };
}

export const simulatedProvider: AiProvider = {
  name: "simulated",
  async generate(req: AiRequest): Promise<AiResult> {
    const started = Date.now();
    if (req.kind === "test") return { text: "ok", model: "simulated", promptTokens: 0, completionTokens: 0, latencyMs: 0 };
    return { text: JSON.stringify(simulate(req)), model: "simulated", promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - started };
  },
};
