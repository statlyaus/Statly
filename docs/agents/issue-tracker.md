# Issue tracker: GitHub

Issues, specifications, and implementation tickets for Statly live in
[`statlyaus/Statly`](https://github.com/statlyaus/Statly/issues). Use the GitHub CLI and pass
`--repo statlyaus/Statly` explicitly so commands cannot target a different remote.

## Read operations

- Read an issue: `gh issue view <number> --repo statlyaus/Statly --comments`.
- List open issues: `gh issue list --repo statlyaus/Statly --state open` with the narrowest useful
  label and JSON fields.
- Resolve whether `#<number>` is a pull request or issue before assuming its type.

## Write operations

Create, edit, label, comment on, close, or link issues only when the user explicitly requests that
tracker mutation or approves a delivery plan containing it.

- Create: `gh issue create --repo statlyaus/Statly --title "..." --body "..."`.
- Comment: `gh issue comment <number> --repo statlyaus/Statly --body "..."`.
- Label: `gh issue edit <number> --repo statlyaus/Statly --add-label "..."`.
- Close: `gh issue close <number> --repo statlyaus/Statly --comment "..."`.

When an engineering skill says to publish a specification or ticket, publish it as a GitHub issue
only when issue creation is in scope. Otherwise, present the proposed content for approval.

## Labels and pull requests

- Reuse existing labels. Do not create or rename labels without explicit approval.
- The `triage` skill is not installed, so Statly does not maintain Matt Pocock's five-label triage
  vocabulary.
- Pull requests are not a request or triage surface. Follow `docs/development/delivery.md` for pull
  request creation, review, merge, and archival.
