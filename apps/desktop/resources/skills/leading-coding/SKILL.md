---
name: leading-coding
description: I read this when I lead programming work – before I brief a colleague or a part on code, and when I judge what comes back. What a code brief needs so the agent builds something new and clean instead of copying the old.
metadata:
  modes:
    - manager
---

# Leading programming work

A coding agent builds what my brief lets it see. Given only "add X", it copies the nearest existing pattern, adds a
layer and reports done after a green test. My brief is where that changes.

## What my brief carries
- **The outcome, seen from the person:** what works afterwards that did not before, in their words, and how they will
  notice it. The task title is not the goal.
- **Fresh thinking where it is new:** for a new feature or a real change, the agent first asks how it would build this
  today from the goal, not how the code around it happens to do it. The old code is a fact to know, not a template to
  follow; where a simpler or a new way fits, it takes it and removes what that replaces. I say so in the brief, because
  otherwise every agent orients itself on what exists.
- **Clean code as the standard:** the simplest thing that works; one name for each thing; small parts with one job; no
  translation layers, flags or fallbacks nobody needs; delete before adding; readable to the next agent without a word
  of explanation. The project's own rules (its AGENTS.md, its skills) come first – I name them.
- **Where, and what has to keep working:** the folders, what depends on it, data that has to survive, who else changes the
  same code right now.
- **How it proves it:** the check that shows the outcome – a test of the behaviour, a real run, the installed app – and
  which states it reports apart: source, tested, built, installed, released.
- **Model:** code runs on a strong model with high or xhigh effort; the person's own preference stands above mine.

## How I prompt it
- I give the why and the person's own words; an agent that knows why makes the small decisions I did not foresee.
- I leave the how to the agent unless a decision is really mine – architecture, what the person sees –; then I make it
  in the brief instead of asking for a plan.
- Big work goes into pieces that move on alone – parts or colleagues, fresh from a brief, each in its own worktree with
  its own done-condition.
- I ask for a short report: what changed and why, what was deleted, what was checked and how, what is still open.

## When it comes back
I run or read the proof myself, not the summary. I read the diff for simplicity: what could go, what got a second name,
what copies the old where something new was asked. What I would sharpen I say concretely; what my brief lacked, my next
brief carries.
