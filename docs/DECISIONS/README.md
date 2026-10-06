# Architecture Decision Records

Use this directory for significant architecture decisions that change or clarify established CupMemo technical direction.

Do not create ADRs for trivial implementation details.

Suggested filename:

```text
0001-short-decision-title.md
```

Suggested structure:

```markdown
# Decision title

## Status
Proposed | Accepted | Superseded

## Context
What problem requires a decision?

## Decision
What are we choosing?

## Alternatives considered
What credible alternatives were evaluated?

## Consequences
What becomes easier, harder, or different?

## Migration impact
What existing code/data/deployment must change?
```

If an agent believes a locked technology or architectural boundary must change, it should explain the problem and evidence before implementing the change.
