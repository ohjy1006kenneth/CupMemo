# CupMemo MVP Design Reference

The MVP reference package was originally distributed as:

`coffee-mvp-reference.zip`

Unpack the package into this directory so the Hermes agents can inspect the actual prototype and specifications directly.

Expected reference files include:

```text
design-reference/
  README.md
  prototype.html
  MVP_SPEC.md
  FLOW_MAP.md
  ...optional screenshot/visual-review helper files
```

## Purpose

These files represent the approved MVP design and interaction reference.

Use them to answer concrete questions such as:
- What does the brew-recording flow look like?
- In what order are screens/states presented?
- How are quick rating and Sensory Detail exposed?
- How should the mobile layout feel?
- What UI hierarchy was already approved?

## How agents should use the reference

### Orchestrator

Before delegating a user-facing feature represented by the prototype:
1. inspect the relevant prototype flow/spec
2. identify the matching GitHub issue
3. include relevant reference details in the delegated task
4. require visual review against the reference

### code-monkey

Do not rebuild represented MVP screens from generic assumptions.

Use the prototype/spec as the implementation target while improving:
- real data integration
- accessibility
- responsiveness
- validation
- loading/error states
- maintainable components

### visual-reviewer

Compare the **rendered implementation** with the reference prototype.

Review both:
- fidelity to approved interaction/layout intent
- quality improvements required for a production implementation

## Source precedence

If sources disagree:

1. explicit current user decision
2. current canonical repository product/architecture docs
3. this MVP reference package for specific UI/flow details
4. general design-system guidance
5. agent preference

Do not silently resolve a meaningful conflict. Surface it and update the authoritative documentation after a decision.

## Important

The reference package is **not** production code and does not define:
- authentication implementation
- API architecture
- database architecture
- security rules
- deployment behavior
- server infrastructure

Those are defined elsewhere in the repository documentation.
