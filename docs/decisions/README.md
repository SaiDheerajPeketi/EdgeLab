# Architecture decisions

Record a decision when it changes a service boundary, durable data model, security policy, supported execution contract or operational tradeoff. Ordinary bug fixes do not need an ADR. Use a monotonically numbered file such as `0001-example.md`; keep accepted records as history and supersede rather than silently rewriting the original decision.

An accepted ADR needs maintainer review. A template or proposed ADR is not evidence that a feature has shipped. Link the source/configuration and validation that support the decision, then update the [architecture](../architecture.md) and [maintenance](../maintenance.md) guides.

## Template

```text
# NNNN: Short decision title

Status: proposed | accepted | superseded
Date: YYYY-MM-DD

## Context
Concrete requirement, constraints and current source references.

## Decision
Selected behavior and boundaries; alternatives considered and why.

## Consequences
Costs, compatibility, privacy, operational and rollback implications.

## Validation
Real checks/evidence and explicit gaps. Link any superseding record.
```
