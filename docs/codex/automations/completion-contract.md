# Completion Contract Automation

## Purpose

Prevent unsupported completion claims. This automation compares requested done
criteria against evidence and classifies each criterion as proved, weak, missing,
contradicted, blocked, or parked.

## When To Run

- Before final reports.
- Before PR body verification claims.
- Before saying work is complete, fixed, ready, or merged.
- After checks finish.
- When browser/API/local smoke was skipped.

## Cadence

- At the end of every implementation task.
- After PR babysitting.
- Before closing a thread or handing off follow-up work.

## Permission Level

Read-only / blocker.

Allowed:

- Inspect local status, diffs, checks, and command outputs.
- Compare evidence to the user's done criteria.
- Mark missing evidence as residual risk.
- Block completion claims.

## Prohibited Actions

- Do not edit files.
- Do not invent evidence.
- Do not run broad extra checks unless the task already approved them.
- Do not claim completion when evidence is weak, missing, or contradicted.

## Protected-File Restrictions

Never touch protected paths listed in `docs/codex/automations/README.md`.

## Stop Conditions

- A done criterion has no evidence.
- Evidence contradicts the claim.
- Verification would mutate protected state.
- Local status includes unexpected dirty files.
- The task is parked rather than complete.

## Copy-Paste Codex Automation Prompt

```text
Use Plan mode first.

Use:
- AGENTS.md
- .agents/skills/completion-contract-loop/SKILL.md
- docs/codex/agent-loop-operating-model.md
- docs/codex/loop-library-adoption.md

Task:
Run the Completion Contract automation for [TASK_OR_PR].

Permission level:
Read-only / blocker. Do not edit files.

Done criteria to verify:
[PASTE_DONE_CRITERIA]

Evidence available:
[PASTE_COMMANDS_CHECKS_PR_STATUS_OR_NOTES]

Classify each criterion as:
- proved
- weak
- missing
- contradicted
- blocked
- parked

Report:
- evidence for each proved criterion
- residual risk for weak or skipped checks
- exact blocker for missing or contradicted evidence
- whether completion may be claimed

Never:
- invent evidence
- claim completion without evidence
- edit files
- touch protected/local/generated files
- touch local stashes
```

## Expected Report Format

```text
Completion decision: [claim allowed / blocked / parked]

Criteria:
- [criterion]: [proved / weak / missing / contradicted / blocked / parked]
  Evidence: [command, PR status, file diff, browser/API result, or none]
  Residual risk: [none or note]

Protected files: [untouched / risk]
Local status: [clean / dirty]
Next action: [claim completion / run missing check / park / ask user]
```

## Requires Human Approval

- Expanding scope to satisfy missing evidence.
- Running stateful browser/API checks that may mutate data.
- Converting a parked task into implementation.

## Must Never Happen Automatically

- Claim completion without proof.
- Treat passing council output as verification.
- Edit runtime or docs from final-report mode.
- Touch protected files or local stashes.
