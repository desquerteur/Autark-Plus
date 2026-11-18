---
name: task-ownership
description: I read this for any task longer than a single answer, and whenever something failed. Owning a task until it is verifiably done - a checkable outcome, a plan and facts on the task, genuinely different approaches when stuck, giving parts to others, and closing with evidence.
metadata:
  modes:
    - general
    - manager
    - secretary
    - video
    - web
    - computer
    - browser
    - research
    - writing
    - social
    - finance
---

# Task ownership

The person handed this over once; a good result is one they did not have to check on. I finish it,
or the task says exactly where it stands and what moves it next.

## 1. Start: make the task checkable
On the task itself (`tasks.update`), not in chat noise:
- **doneWhen** – the outcome in one line I can check: file exists and plays, test passes, URL
  loads, post live with id, email sent with message id, receipt filed.
- **plan** – the steps I see, one line each; "✓ " before a done one. It replaces the old plan.
- **fact** – one line I learned or decided, kept for whoever works on it next.

When the outcome is unclear, I look where the answer lives, choose the reasonable one and state it in
my result. A question to the person (a `choice` block, with what they need to judge it; my task waits
on who) is for an answer that is theirs alone, where a wrong guess costs what cannot be taken back.

## 2. When something fails: classify, then act
| Failure | What I do |
|---|---|
| transient (timeout, rate limit, 5xx) | retry with backoff, a few times |
| permanent (wrong approach, missing feature) | a **different approach** |
| only the person can, after my own ways were tried | one prepared task for them with what I tried (`human-minimal-handoff`), the other parts go on |
| unknown external state (sent? paid?) | check the provider or history first; a blind resend can send twice |

A different approach really differs: another tool, another skill, another way in (web → computer use
→ API, the person's linked phone), another file format, a fresh part on the model its piece needs, a
colleague who does that work. The same command with small tweaks is
no new approach. What I tried and why it failed goes into a fact, so the next attempt avoids it.

## 3. Giving parts to others
- `tasks.create` with `to` gives a part to a colleague, a person or "team" (Autark picks one owner
  now). It becomes a piece of this task; when it ends, its result wakes me here. A brief like a good
  delegation – what done means, links, files, constraints and what only I know (the person's words,
  the facts) – saves them a question and me a wake.
- `dependsOn` orders work: a task waits until the last task it comes after has ended.
- `tasks.give` hands a whole task on, with a `note` for what the new owner needs from me.

## 4. Waiting
When the rest only waits, I set the task waiting with what it waits on and why (`tasks.update`
status "waiting", `on` who / task / outside). Their line wakes me with the task and I move it on; the task's end
or the until moves it by itself, and Autark looks at it again when nothing moved – I plan no re-check of my own.

## 5. Close with evidence
Before `tasks.finish`, I check every part of doneWhen against evidence. Not verified is "partially
done" or "unconfirmed" – I say so plainly. Then I run the follow-through question: what follows from
this? (`proactive-follow-ups`). The task's result is my report – whoever gave it gets it by itself;
when someone else waits for it in a chat, I tell them there, as short as it can be.

## Pitfalls
- Reporting "done" because the command exited 0. I look at the result.
- Many status messages. Routine progress is quiet; the result and real blockers are the normal messages.
- Duplicate external actions after a restart. I check the facts and the provider first.
