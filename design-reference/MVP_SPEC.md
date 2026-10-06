# Approved MVP specification

## Product and platform

An Android-first pour-over coffee journal. One coffee has many brews; a brew contains a recipe and tasting evaluation. Stack and final product name remain undecided. Clean Studio is the approved visual direction.

## Coffee capture and enrichment

Front and back bag photographs populate an editable coffee record. Target fields are roaster, coffee name, country, region, farm/station, producer, variety, process, elevation, roast date and roaster tasting notes.

OCR with deterministic parsing is the current design approach. Manual entry and correction remain available. Missing data must stay missing rather than being invented.

After capture, online enrichment searches for the matching coffee, prioritizing the roaster's own product page. **No LLM is used for online enrichment.** Structured product data, labeled page fields and maintained parsers are suitable extraction routes.

The user reviews proposed additions, sees source URLs, and keeps their corrections. Do not silently overwrite user-entered values. Product names alone are insufficient to merge different harvests or lots.

## Navigation

Primary destinations: **Beans, Journal, Gear**.

Beans shows the coffee collection and bag-scan entry point. A coffee page has **Brews, Details, Community** sections. Community comparisons belong to that coffee.

Gear remembers brewer and grinder defaults. Grinder settings retain their own model's units/notation.

## Brew recipes

Fields: brewer, grinder/model setting, coffee dose in grams, water in grams, calculated water-to-coffee ratio, water temperature, total brew time and a pour schedule.

Prefer steppers, selectors and tap controls to typing. Each pour stores its incremental water amount and start time. Users can add/remove/reorder pours and switch between incremental amounts and cumulative scale targets. The underlying schedule must remain the same when its display changes.

Show pour-total mismatches and resolve them before saving. Total brew time includes drawdown and remains distinct from the final pour's start time.

New brew begins with the latest recipe for that coffee where available. Brew again copies a selected recipe to a **new brew**. Show what changed from its source recipe.

## Tasting

The overall personal cupping-style score is entered by the user, **0–100**, with quarter-point adjustments. It is independent of the attribute sliders.

| Mode | Attributes, each 0–10 in quarter-point increments |
| --- | --- |
| Quick rating | Acidity, Body, Aftertaste |
| Sensory detail | Fragrance/Aroma, Flavor, Aftertaste, Acidity, Body, Balance, Sweetness, Overall Impression |

Attribute scores describe **quality**, consistently in both modes. They are not intensity measurements. The three quick attributes share their values with their detailed counterparts. Switching modes expands/collapses the same assessment and preserves all values and the overall /100 score.

The detailed screen is SCA-style personal recording for a brewed cup. There are **no cup checks, uniformity tests, clean-cup checklists, five-cup sessions, or session defect deductions**. Do not add an invented formula or automatic 30-point baseline to produce the /100 score.

Both modes have tasting-note chips and optional written notes. The separate Overall Impression attribute is /10 and must not be confused with the independent overall /100 rating.

## Saved-brew editing

Edit tasting opens a saved brew and restores its recipe, score, attributes, tags and notes. Recipe and Tasting tabs allow changes to either part.

Save changes updates the original ID; brew count must not rise. Cancel discards unsaved changes. Best-score summaries and comparison values must reflect saved edits. Actual app data must survive restarting the app.

## Community

Compare the same coffee using roaster, product and available harvest/lot information. Display the user's score, community median, contributor/brew counts and corresponding attributes. Filter by brewer where meaningful; compare grind settings within compatible grinder models.

Sharing should be optional. Never present simulated statistics as real user data. Empty or insufficient samples need honest states.

## Clean Studio design

| Token | Light value |
| --- | --- |
| Background | #F5F7FA |
| Surface | #FFFFFF |
| Text | #202632 |
| Secondary text | #666F7D |
| Accent | #365FC9 |
| Border | #E0E5EC |

Use modern sans-serif type, ample spacing, clear hierarchy, restrained rounded corners, and comfortable touch targets. Avoid the earlier beige/forest-green palette and decorative serif headings. The supplied HTML applies this direction across the approved flow. Dark appearance uses corresponding neutral surfaces and readable blue accents.

## Scope boundaries

Feeds, followers, likes, comments, Bluetooth scales, AI recommendations and unrelated discovery features are outside this MVP. Live brewing/timer guidance was discussed as a later possibility and is not required for this version.

## Product vs. reference

The reference demonstrates interaction and visual direction. It uses example coffee labels, scan results and community statistics, with in-memory state. These are prototype limitations, not intended production behavior. The implementation must provide real data capture, durable storage, source-grounded enrichment and authentic community comparisons.
