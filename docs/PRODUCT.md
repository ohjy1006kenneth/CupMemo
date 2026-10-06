# CupMemo Product

## Product definition

CupMemo is a personal coffee brewing journal.

It helps coffee drinkers:
- record a brew quickly
- remember recipes and parameters
- remember which brews they liked
- compare later brews with earlier ones
- optionally record more detailed sensory impressions

CupMemo is intended for everyday specialty-coffee use, not formal professional cupping sessions.

## Core product principle

> Easy enough to use every morning, detailed enough to become useful over time.

The primary workflow must remain fast.

A user should not be forced through a large tasting questionnaire to save a brew.

## MVP evaluation model

CupMemo has two levels of evaluation.

### Quick evaluation

A lightweight overall assessment used during normal daily brewing.

A brew must be savable using only the normal brew information plus quick evaluation.

### Sensory Detail

Optional deeper notes for users who want more detail.

The canonical primary sensory dimensions are:

- **Acidity**
- **Body**
- **Aftertaste**

Use these names consistently throughout the UI, API, schema, documentation, and tests.

CupMemo is **SCA-inspired**, but it is not a complete SCA cupping application.

There is no **Cup Checks** feature.

## MVP priorities

1. Authentication
2. Record coffee information required by the brew workflow
3. Record a brew
4. Quick evaluation
5. Optional Sensory Detail
6. Browse brew history
7. View a brew
8. Edit a brew
9. Mobile-first PWA experience
10. Reliable self-hosted deployment

## MVP exclusions

Do not add these unless explicitly approved later:

- social feed
- follows/followers
- public profiles
- marketplace
- subscriptions
- gamification
- achievements
- leaderboards
- AI tasting analysis
- AI brew recommendations
- automatic grinder adjustment recommendations
- full coffee inventory system
- formal competition cupping tools
- native iOS/Android apps
- smartwatch app
- large analytics platform

Future ideas can be recorded separately but should not silently enter MVP scope.

## Platform strategy

MVP is a **mobile-first responsive Progressive Web App**.

A future native client may use Expo / React Native and the same Fastify API.

Do not build the native client during MVP.
