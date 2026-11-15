// Compaction policy (CTX7, B-080): the fit of an agent's context to the model's window. B-080 (owner 08.11.2026: "keine
// Verdichtung bei 150k oder 128k … dann ist ja alles wichtige Kontext auf einmal weg … das muss komplett dynamisch sein"):
// no working set any more. A native session lives on like a plain Codex or Claude Code session, and what stays in it is
// decided item by item – the subconscious condenses and hides what the work no longer needs and the next turn's rebuild lands
// it (agents/rebuild.ts, context/ledger/window.ts). The only size rule is the model's window: a session whose context no longer
// fits (pastFit: above FIT_SHARE of the window) gets the oldest tool work of its part hidden – restorable like any mark –
// and only when even that does not bring it in, it is renewed (turn-prepare.ts renewSession: dropped binding; the next turn
// rebuilds from the agent's record or gets it as text – 13.11.2026: never a chat's history, there are no chat summaries).
// Inside one turn the engine keeps its own limit at the edge of the window, as in the plain CLI.
// Owns: the fit of the window.

/**
 * The share of the model's window a session's context may fill between turns (ARCHITECTURE §13). The rest is room for the
 * next turn's own work: the engines compact a session themselves near the edge (Codex and Claude Code at about 90 %),
 * all at once – the oldest tool work hidden here comes first and leaves the person's words and the recent work in place.
 */
export const FIT_SHARE = 0.8;
/** The window assumed for a model whose window is unknown: the smallest of today's frontier models. */
export const DEFAULT_WINDOW = 200_000;

/** The most context tokens a session carries between turns: FIT_SHARE of the model's window (DEFAULT_WINDOW when unknown). */
export function fitLimit(contextWindow: number | undefined): number {
  return Math.floor(FIT_SHARE * (contextWindow && contextWindow > 0 ? contextWindow : DEFAULT_WINDOW));
}

/** The context no longer fits the model's window with room for the next turn. */
export function pastFit(contextTokens: number | undefined, contextWindow: number | undefined): boolean {
  return (contextTokens ?? 0) > fitLimit(contextWindow);
}
