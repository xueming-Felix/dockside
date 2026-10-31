# Decisions and rationale

## 2026-10-31 — Initialize Dockside around the owner's existing repository

**User direction:** initialize a new hackathon project with a new repo, folder and group for `git@github.com:xueming-Felix/dockside.git`. [Request](journal/2026-10/cap_baf32724-7d80-4539-baf0-64d272450b90.md).

**Assistant choices:** the repository already existed with the owner's plan commit `ea25a39`, so the workspace's automatic `gh repo create` failed ("Name already exists") and the project was linked to the existing remote instead of a second repository. Local main was rebuilt on `ea25a39` with the workspace scaffolding committed on top, keeping the owner's history intact and linear; the generated "Initialize Dockside" commit was dropped because its files are carried in that commit. The owner's README is kept verbatim with a workspace section appended. Project ID `dockside`, name Dockside, purpose paraphrased from the owner's README and PLAN.md. The dedicated Lark topic group was created through `workspace provision`; the originating Personal Workspace topic keeps its binding. [Setup receipt](journal/2026-10/cap_9dd3bc10-281b-4e9e-9120-bfba30878d18.md).

**Provisioning deviations:** Lark admitted only the creating Codex bot (cross-app bot invites are refused), and Botmux skipped the group's working-directory binding after that partial failure. The Codex bot's binding to this folder was added by hand under Botmux's own bots.json file lock, with a backup outside Git. Adding Felix-Claude is an owner step; `scripts/add-bot.mjs` then mirrors its binding.

**Scope and status:** initialization complete. Plan, personas and scenario are the owner's team decisions as recorded in PLAN.md, not assistant proposals. No application code, task, schedule, paid API use, deployment or Devpost action was started here.
