---
name: implement
description: "Implement a ticketed specification with GPT-6 Luna workers while the primary agent reviews, verifies, and sends corrections back before accepting each ticket."
---

# Implement a ticketed spec with Luna workers

Implement an approved specification through its dependency-linked tickets. The
primary agent owns orchestration and acceptance. GPT-6 Luna subagents own all
implementation edits.

This workflow is for a spec that already has agent-ready tickets. Use the
configured tracker and domain rules in `docs/agents/`.

## Non-negotiable model policy

- Spawn every implementation worker with `model: gpt-6-luna`.
- Use `reasoning_effort: medium` for clear, bounded tickets.
- Use `reasoning_effort: high` for database migrations, authorization,
  concurrency, or tickets whose acceptance depends on several interacting
  systems.
- Never let an implementation worker inherit the primary agent's model.
- The primary agent reviews and verifies the work. Do not delegate ticket
  acceptance to another model.
- The primary agent must not implement rejected ticket code itself. Send
  concrete feedback to the same Luna worker and have that worker correct it.
- Treat a rejected or unsupported `gpt-6-luna` spawn as a blocker. Never
  retry the ticket with an inherited or substitute model.

The dependency frontier is still useful for deciding which ticket can start.
It is a property of the task graph, not a model choice.

## Read before dispatching work

Read:

1. The repository instructions.
2. The tracker and domain configuration under `docs/agents/`.
3. The complete spec and every ticket in its graph.
4. Relevant ADRs and existing code around the first runnable ticket.
5. The current working-tree status so existing user changes are not mistaken
   for worker output.

Build the blocking graph from each ticket's `Blocked by` field. A ticket is
runnable only when every blocker has `Implementation: resolved`.

Before changing ticket state, validate that every ticket has exactly one
implementation-state field whose value is exactly `unclaimed`, `claimed`,
`blocked`, or `resolved`. Verify that every blocker exists and the graph has no
cycle. Stop and repair the tracker with user approval if the graph is malformed.
Do not infer dependencies from ticket numbering or unknown state values.

Do not create branches, commits, pull requests, worktrees, or external tracker
records unless the user explicitly authorizes them. This repository's normal
workflow uses local Markdown tickets and a shared working tree.

## Hold the implementation lock

Only one primary workflow may dispatch write-enabled agents for a spec at a
time. Atomically add `implementation.lock` in the feature's local tracker
directory before claiming a ticket. Use a create operation that fails when the
file already exists, such as an `Add File` patch. Never use a separate
check-then-create sequence. After creation, reread the lock and verify its
contents before dispatching. Record:

- the primary task or session identifier when available;
- the current ticket number;
- the UTC claim time;
- the worker task identifier after a successful spawn.

If the lock already exists, stop. Do not assume it is stale or delete it
without user confirmation. Remove the lock only after the full spec resolves,
after a blocked state has been recorded, or when the user explicitly cancels
the run.

## Claim one ticket

Choose the lowest-numbered runnable ticket unless another order has a concrete
benefit. Before dispatch:

- Change `Implementation: unclaimed` to `Implementation: claimed`.
- Do not claim a ticket that is already claimed, blocked, or resolved.
- Record the ticket path, claim time, review-round count, expected files or
  subsystems, and worker identifier in the ticket.
- Record the current branch, `HEAD`, unstaged changes, and staged changes before
  dispatch. Include hashes for dirty files so later review can distinguish the
  baseline from worker output. Preserve this snapshot outside the repository
  diff when practical.

Agents in this environment share one working tree. Run only one write-enabled
implementation worker at a time. Read-only exploration or test-log analysis may
run concurrently when it cannot race with the writer.

## Plan verification before dispatch

Record a short verification plan in the claimed ticket. Tie each check to an
acceptance criterion and a credible failure; repository and spec requirements
remain mandatory. State:

- the changed behavior and the cheapest check that can actually prove it;
- worker checks and the primary's independent checks;
- when focused, integration, full-suite, or native checks run;
- existing evidence that may be reused and what would invalidate it;
- any fixture, device, database, or build needed for those checks.

Choose checks by risk rather than ticket size. A presentation change needs the
changed flow and relevant appearance/interaction states. Date or split logic
needs boundary cases at its production owner. Persistence, authorization,
lifecycle, and concurrency changes need real integration evidence for the
applicable failure, beyond mocks or screenshots.

Use focused checks during corrections and run broad checks at integration or
final acceptance unless the repository or ticket explicitly requires them
sooner. Consolidate checks that prove the same contract. Honor mandatory Git
hooks; do not disable them to avoid repeated runs. Freeze affected source while
checks run so their results describe one revision.

### Reuse evidence only while it remains valid

Record the command/scenario, result, source revision or relevant file hashes,
fixture/configuration identity, and runtime/build identity when applicable.
Keep secrets out of this record. A commit SHA alone is insufficient when the
worktree is dirty.

Review prior evidence before rerunning it. Reuse independently verified results
only when the checked code, dependencies, configuration, fixtures, and runtime
are unchanged. An upstream change that affects the checked path invalidates
its evidence even if the test file is unchanged. Rerun the affected checks after
a correction; retain valid evidence for untouched paths. Reused worker reports
alone never substitute for the primary's independent verification.

### Native build and review decisions

Before a device run, check the selected device, installed binary, app session,
backend, and fixture readiness. Verify the automation API exists in the
installed tooling before using it.

Rebuild for changed native dependencies, config plugins, native source, or SDK
versions. For JavaScript-only changes, use the compatible development client's
refresh flow when available. A release app with an embedded bundle must receive
an updated bundle/build before it can verify changed JavaScript. Record which
source the running app contains; an old binary's screenshots are not new proof.
Group related native scenarios into one prepared run when practical. Repeat
only scenarios whose evidence was invalidated, plus interactions affected by
combining tickets. Preserve required platform, theme, safe-area, and keyboard
coverage.

Set a bounded diagnostic budget for environment failures. Before retrying an
unchanged failure, identify a cause and change something that could address it.
Do not rebuild repeatedly without evidence that the binary is responsible.
Record infrastructure failures separately from product failures and continue
independent checks. If a required criterion remains unverified, keep acceptance
open and explain the missing proof; reuse rules do not waive requirements.

## Dispatch the Luna worker

Give the worker context pointers instead of pasting the whole project history:

- the spec path;
- the claimed ticket path;
- relevant ADR or research-note paths;
- the repository instructions;
- known pre-existing working-tree changes;
- the verification plan and reusable evidence, including invalidation conditions.

Tell the worker to:

- implement only the claimed ticket;
- inspect the surrounding code before editing;
- preserve unrelated and pre-existing changes;
- follow TDD when the ticket introduces or changes testable behavior;
- run focused checks while working;
- run the checks assigned to the worker by the verification plan;
- report which required checks remain for primary or final acceptance;
- avoid commits, branches, tracker edits, and subagents;
- return the files changed, checks run, results, and any remaining concern.

After the spawn succeeds, record its returned task identifier in both the
ticket and the implementation lock. The explicit spawn request is the model
evidence available to the workflow. Record `gpt-6-luna` as the requested
model. If the spawn API rejects the model or does not return a worker handle,
set the ticket to blocked and stop. Do not dispatch a fallback model.

Do not ask the worker to solve later tickets opportunistically. Small
prefactoring is allowed only when it is needed to land the claimed ticket green
and stays within its acceptance boundary.

## Primary-agent review loop

When the Luna worker finishes, the primary agent must review before accepting
the ticket.

1. Inspect every changed file and the surrounding execution path.
2. Compare behavior with each acceptance criterion, the spec, repository
   instructions, and relevant ADRs.
3. Check for unrelated edits, unsafe migrations, weak assertions, hidden
   cleanup failures, race conditions, and behavior that only works because of
   test ordering.
4. Independently verify the changed behavior using the ticket's plan. Select
   focused checks in proportion to risk and review reusable evidence against
   its invalidation conditions. Do not accept a worker's reported result alone.
   Rerun affected checks when source, fixtures, configuration, or runtime drift.
5. Review the actual diff, not only the worker's summary.
6. Confirm that the branch, `HEAD`, and staged-change snapshot still match the
   pre-dispatch state. A worker must not commit, switch branches, or stage
   changes. If it did, do not rewrite Git history or unstage user work. Record
   the evidence, block the ticket, and ask the user how to proceed.
7. Run any measurement or evidence step that the spec applies to every ticket,
   even when the ticket repeats only its ticket-specific checks.

If the task measures performance, store reproducible evidence under the
feature's local tracker directory, grouped by ticket. Record the run ID, UTC
time, branch and `HEAD`, simulator or device, app binary identity, database
environment, command, raw durations, median, and comparison baseline. A summary
without the raw runs is not enough to resolve a performance criterion.

If the current worktree contains a new change outside the worker's reported
files and the recorded baseline, pause review and ask the user whether that
change is theirs. Do not attribute it to the worker or overwrite it.

If anything is missing or wrong, send feedback to the same Luna worker. Make
the feedback actionable:

- cite the acceptance criterion that is not met;
- name the observed behavior or failing check;
- point to the relevant file or symbol;
- state what evidence will demonstrate the correction.

Ask the worker to patch the current shared working tree and rerun the focused
checks identified by the plan. Update evidence invalidated by the correction
and review the new diff again. Allow at most three correction rounds for
the same ticket and persist the round count and latest feedback in the ticket.
After the third unsuccessful round, set
`Implementation: blocked`, append the evidence and remaining problem to the
ticket, and stop for user direction. Do not silently take over the fix.

Use the recorded worker task identifier for every normal correction. If that
worker is unavailable, record the failure and inspect the shared tree before
doing anything else. Consult the authoritative agent-status operation using the
recorded identifier. Never start a replacement while the original worker is
running or when its liveness cannot be established. If the status proves the
worker has stopped, a replacement may be another explicit GPT-6 Luna worker
on the same ticket after updating the lock and ticket with the replacement
identifier. Count the replacement as a correction round. If authoritative
status is unavailable, block the ticket and ask the user. Never replace the
worker with the primary agent.

## Accept a ticket

Accept a ticket only when:

- every acceptance criterion is satisfied or explicitly marked not applicable
  with a reason approved by the user;
- required checks pass with current independent evidence, whether newly run
  or validly reused;
- the primary agent finds no unresolved correctness or scope issue;
- unrelated user changes remain intact.

Then:

- check the verified acceptance boxes in the ticket;
- change `Implementation: claimed` to `Implementation: resolved`;
- append an `## Implementation evidence` section containing the changed areas,
  checks run or reused with their source/runtime identity, measurements
  required by the spec, results, requested worker model, worker identifiers,
  and number of review rounds;
- report which tickets became runnable.

Do not mark a ticket resolved because its worker finished, because most tests
passed, or because a downstream ticket needs it.

## Continue through the graph

Repeat claim, dispatch, review, feedback, and acceptance until every ticket is
resolved or one becomes blocked.

After all tickets resolve:

1. Review the combined diff against the full spec.
2. Run the repository's full required checks once for the combined final
   revision. A prior independent run qualifies only if its inputs still match;
   rerun affected checks after subsequent corrections as required by repo policy.
3. Complete integration or E2E verification required by the spec. Batch native
   review against the final app source and reuse valid evidence for unaffected
   scenarios. Name any unverified requirements instead of implying coverage.
4. If cross-ticket behavior fails, reopen the narrowest responsible ticket and
   run its claim, Luna dispatch, lock, review, and evidence protocol again. If
   no existing ticket owns the failure, create a narrowly scoped stabilization
   ticket with explicit blockers and acceptance criteria before dispatching a
   GPT-6 Luna worker. Stabilization work may not bypass ticket state or the
   three-round review limit.
5. Report the final measured result, unresolved risks, and working-tree state.

Do not commit, push, open a pull request, deploy, or publish unless the user
explicitly requests that action.
