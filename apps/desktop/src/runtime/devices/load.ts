// A PC's load as its ping answers it (chat sweep 16.11.2026, owner 06.11.: "ihr könnt auch gerne das Notebook verwenden …
// das Notebook ist grad nicht so ausgelastet"): free memory in MB and the agent turns at work on it, so devices.list
// (list-tool.ts) shows which linked PC is idle and an agent can move its work there (agents.update device). A snapshot;
// a PC on an older version answers its ping without it.
// Owns: the load value and reading it from a ping's answer. Never: decides where work goes.

import { freemem } from 'node:os';

export interface DeviceLoad {
  /** Free memory of the PC now, in MB. */
  freeMemoryMb: number;
  /** Agent turns running on it now. */
  runs: number;
}

const MB = 1024 * 1024;

/** This PC's load now, with `runs` turns at work. */
export function deviceLoad(runs: number, free = freemem()): DeviceLoad {
  return { freeMemoryMb: Math.round(free / MB), runs };
}

/** The load in a ping's answer; undefined from a PC that does not send one (older versions) or a malformed one. */
export function loadIn(answer: unknown): DeviceLoad | undefined {
  const load = answer && typeof answer === 'object' ? (answer as { load?: unknown }).load : undefined;
  if (!load || typeof load !== 'object') return undefined;
  const { freeMemoryMb, runs } = load as Record<string, unknown>;
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  const free = count(freeMemoryMb);
  const busy = count(runs);
  return free === undefined || busy === undefined ? undefined : { freeMemoryMb: free, runs: busy };
}
