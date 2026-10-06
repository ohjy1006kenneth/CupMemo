# CupMemo Agent Operating Rules

This file defines how the Hermes agents should work on CupMemo.

## Source of truth

Before planning or implementing meaningful work, read the relevant repository documentation:

- `docs/PRODUCT.md`
- `docs/MVP_FLOW.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`

Use GitHub milestones and issues as the execution backlog.

Do not rely on conversation history as the only source of project decisions.

## Agent roles

### Orchestrator

Owns:
- task decomposition
- sequencing
- architecture consistency
- product consistency
- delegation
- integration
- issue acceptance criteria
- documentation updates

The orchestrator should not silently redesign locked product or architecture decisions.

### code-monkey

Primary implementation agent.

Expected to:
- implement scoped issues
- follow existing architecture
- add/update tests
- keep changes focused
- report blockers rather than inventing broad redesigns

### code-reviewer

Reviews:
- correctness
- architecture drift
- authentication and authorization
- IDOR/data ownership risks
- validation
- migrations
- error handling
- security
- maintainability
- unnecessary complexity
- test quality

### visual-reviewer

Reviews the **rendered UI**, not only code.

Check:
- Clean Studio consistency
- mobile ergonomics
- responsive behavior
- hierarchy
- spacing
- typography
- forms
- loading/error/empty states
- accessibility
- touch targets
- overflow and scrolling

## Working rules

1. Work milestone-by-milestone unless a dependency requires otherwise.
2. Prefer small, reviewable issues and pull requests.
3. Do not mark an issue complete until its acceptance criteria pass.
4. Update documentation when implementation changes an established behavior or architecture.
5. Keep TypeScript strict.
6. Do not commit secrets, production data, database files, backups, uploads, or `.env`.
7. Do not introduce large infrastructure such as Kubernetes, Redis, Kafka, RabbitMQ, or Elasticsearch without a real requirement.
8. Prefer clear boundaries and simple systems over cleverness.
9. Do not silently replace approved technologies.
10. Protect unrelated services already running on the Raspberry Pi, especially Hermes.

## Quality gates

For relevant work, run:

- formatting check
- lint
- TypeScript typecheck
- tests
- production build
- end-to-end tests for critical flows

UI work should also receive visual-reviewer review.

## Architecture-change rule

If an approved architectural decision creates a real problem, document:

1. the problem
2. evidence
3. proposed alternative
4. migration impact

Use an ADR under `docs/DECISIONS/` for significant changes.
