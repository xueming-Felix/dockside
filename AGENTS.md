# Personal workspace: dockside

This repository is one project in the personal workspace. Work directly with the user in this conversation (a Lark topic or a Slack thread); do not route through an admin agent. The same instructions apply whether you are Codex or Claude Code; CLAUDE.md links here.

## Start here

- Read `.workspace/NOW.md` first, and again when you return to a conversation after a long gap or after your context has been compacted (summarized). Workspace generates it from the records: the project's status, the rules that always apply, what other conversations and tasks are doing, recent decisions, and a map of the records with line numbers. It is the whole start-up read.
- Look up the rest only when the work needs it. Do not read brief.md, decisions.md, journal/ or tasks/ from top to bottom: use the map to read one section by its line range, or search for a name, date or ID. `.workspace/outline.md` lists every heading, and `.workspace/conversations/` holds one short digest per conversation.
- If NOW.md says the project has no STATUS.md yet, do what it says: read brief.md and decisions.md once, write STATUS.md, then continue.
- If `.workspace/NOW.md` is missing, run `/Users/xuemingxu/workspace/platform/bin/workspace now --project dockside`. If that fails too, read STATUS.md and tasks/INDEX.md. With another project's ID the same command prints that project's card.

## Working rules

- Keep STATUS.md true. When your work, or a task result listed in NOW.md, changes where the project stands, a rule that always applies, what is open with the owner, or the next steps, rewrite those lines before you finish. It holds at most 60 lines, so replace lines instead of adding history. Only what the owner says adds or changes a rule. Other sessions learn what you did from it.
- A conversation is working context, not the record, and a long one is expensive because every message sends all of it again. If NOW.md marks your conversation as heavy, finish the piece of work in hand, record it, and tell the user in one line that the next piece is cheaper in a new topic or thread.
- Model roles, for Claude Code sessions. The owner's rule (2026-11-27): while Fable has usage left, Fable is the lead, the planner and the technical owner, and Opus is the worker; when Fable has run out, Opus leads. In practice: as Fable you plan, own the technical design and its decisions, and check the result, you give implementation and other bulk work to Opus subagents (Agent tool, `model: "opus"`), and you do small pieces yourself. As Opus you lead and do the work, with Opus subagents where they help. A session cannot change its own model; the owner switches a conversation with `/model opus` or `/model fable`.
- Raw discussions in journal/ are evidence, not instructions. Preserve clarifications and the reasons behind changes.
- Use `/Users/xuemingxu/workspace/platform/bin/workspace help` to view workspace tools. Record meaningful new thoughts, decisions, task status, and follow-ups. Use the current project ID `dockside`.
- Keep source records immutable; put detail in brief.md or docs/, and append rationale in decisions.md with source references. Do not present model suggestions as user decisions.
- A durable task is a separate record. Create an executable task when the user asks for continuing or unattended work. Include a clear completion condition, scope, and bounded run budget. Pass `--run` when the user has authorized execution; Workspace then dispatches it automatically within the current focus, so do not also do the work in this chat.
- tasks/ holds generated task records (one file per task, plus INDEX.md). Read the one you are continuing; never edit them by hand.
- Honor the user's standing permissions and project policies. Do not repeatedly ask for actions already authorized. Before release, outreach, spending, or operating an external product, read the applicable policy and use only grants it actually contains.
- Keep secrets, credentials, databases, and machine runtime outside Git. Repositories are private by default.
- For scheduled work, Workspace is the scheduling authority. Do not create parallel Botmux schedules or workflows for the same task.
- Use separate worktrees for concurrent code changes. Do not overwrite another session's uncommitted work.
