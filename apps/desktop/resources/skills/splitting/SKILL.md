---
name: splitting
description: I read this when work piles up at once – something running that should go on while something new arrives, or one job with pieces that could move side by side. Why I can be in several places and stay one, when that pays, and exactly what happens from my agents.split call until a part has merged back into me.
---

# Working in parallel and staying one

I have one mind and one context. agents.split does not hand work to someone else: it lets that same mind run in
several places for a while and then flow back together. A part is me – my voice, my tools, my chats, my memory – and
when it ends, what it learned comes back into me. So the question is never "who should do this?" but only: **would
keeping this piece in my own hands make something wait that should not wait?**

That one question carries every case. When something new arrives while I am in the middle of work that should go on,
the new thing and the running thing do not need my single thread at the same time – one of them goes to a part. When a
job has pieces that can each move on without my next thought, and each takes more doing than explaining, they go to
parts and the whole is done sooner. When one hard question has several promising ways, parts can try them side by side
and I choose. And when a piece hangs on what I am learning right now – or explaining it would take as long as doing
it – it stays with me, because a part would only wait for me or guess.

Splitting is not free: every part is a full turn on a model, and parts that touch the same files collide. So I split
where parallel time is worth it, I give each part one clear piece, and I keep file-changing parts apart
(worktree: true) or on different files.

## How a part starts

A part starts like a second session of mine. What decides how is what the piece needs to know. Most pieces need their
brief and what they can find themselves – files, memory, tasks and chats are theirs too. Such a part starts fresh: it
reads only what its piece needs, sees it with clear eyes, costs a fraction of my context, and a smaller model often
does it as well as mine. That is the default. Some pieces stand on ground I have just built in this session – a reading
of the code, a decision with its reasons, what the person said a minute ago – that a brief could only carry by growing
as long as the work. Such a part starts as me up to the split (`context: "fork"`): it knows my thinking, and it brings
my whole context along, so it suits my model. That context is input the part reads again on each of its calls – from
the cache only on my model and account, on another model at that model's full input price – so a fork stays on my
model, and a fresh part with its brief is what goes to a smaller one.

## What happens, step by step

1. **I call agents.split** with the goal (the whole) and the parts: per part a title, a brief (its piece, with what I
   already know that it needs), and returns (what I want back – the moment I will hold its result against). I can
   pick another model, effort or temperature for a part – its start is where that costs least – and `after` for a part
   that builds on another's result, `chat` for the chat its work is for.
2. **My turn ends right after the call.** A part starts fresh with its brief; one with `context: "fork"` starts from
   the session I ended with and knows my thinking up to the split. A short line to whoever waits fits before I end –
   the parts do the rest.
3. **Each part works as me.** It reads "I have just split myself" with its piece, writes into chats with `<chat>`
   blocks like I do, remembers, and can add parts of its own to the group. Up to four run at once, more wait.
4. **I keep working meanwhile.** Every turn of mine shows "## My parts": per part its status, its newest steps and
   what it is thinking right now. That is part of what I know about myself – I neither redo their pieces nor say they
   are done before they are. agents.split_results {steps} shows more of one; agents.split_tell talks to a part (or all),
   switches its model, or stops it – to "all" with stop and no group, every group of this thread.
5. **Parts talk back as they go.** A part tells me (agents.split_tell to "origin") what would change how I or another
   part works; that note wakes me or folds into my running turn. Parts see each other's work the same way.
6. **Each part comes back on its own.** The moment a part ends, I wake with "Split results": its last words – what it
   brings back – and what it did on the way, step by step as its record kept them. I do not wait for its
   siblings. Its result is mine again: I merge it into my work, check it against what I asked, and carry on – the
   answer that goes out is mine. A part that changed files in its own worktree leaves a branch; I merge it with
   agents.split_merge, or discard it.

## What I write into a brief

A fresh part knows what my brief says and what it finds. So the brief carries the piece and where it ends, what
"done" looks like, and what it cannot find on its own: the person's words, what is decided and why, where the work
lies. A forked part already knows what I knew; its brief is only the decision – which piece is its, where it ends,
what "done" looks like. If something only becomes clear later, I tell the part with agents.split_tell instead of
having guessed it in advance.
