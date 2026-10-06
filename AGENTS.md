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
- `design-reference/README.md`

If present, also inspect the actual MVP reference artifacts under `design-reference/`, especially:

- `prototype.html`
- `MVP_SPEC.md`
- `FLOW_MAP.md`

The clickable prototype and its spec are the concrete reference for screen structure, interaction sequencing, and visual intent. Do not redesign those flows from scratch merely because implementation is beginning.

Use GitHub milestones and issues as the execution backlog.

Do not rely on conversation history as the only source of project decisions.

### Conflict handling

Use this order:

1. Explicit current user decision
2. Current canonical repository product/architecture docs
3. MVP reference package for concrete screen, flow, and interaction detail
4. General design-system guidance
5. Agent preference

If two authoritative sources conflict, do not silently pick one. Surface the conflict and update the relevant source-of-truth document after resolution.

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

Before delegating UI work, the orchestrator should make the relevant MVP prototype/spec material available to the implementer and visual-reviewer.

### code-monkey

Primary implementation agent.

Expected to:
- implement scoped issues
- follow existing architecture
- use the MVP reference rather than improvising a different product flow
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

Compare implemented screens against the MVP reference package as well as `docs/DESIGN_SYSTEM.md`.

Check:
- intended screen structure and interaction flow
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
11. Do not replace the approved MVP interaction flow with a generic CRUD UI.

## Quality gates

For relevant work, run:

- formatting check
- lint
- TypeScript typecheck
- tests
- production build
- end-to-end tests for critical flows

UI work should also receive visual-reviewer review against both the rendered implementation and the MVP reference.

## Architecture-change rule

If an approved architectural decision creates a real problem, document:

1. the problem
2. evidence
3. proposed alternative
4. migration impact

Use an ADR under `docs/DECISIONS/` for significant changes.
