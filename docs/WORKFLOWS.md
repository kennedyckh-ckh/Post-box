# Workflow states and permitted transitions

Four things are kept apart so that one can never change another by accident: **stage release**, **group submission**, **publication**, and **AI output status**.

## Session

`setup` → `live` → `archived` → back to `live` (if it had been started) or `setup` (if not).

- **setup**: the facilitator configures. Participants cannot join unless “Let participants join before I start” is on. No stage can be opened.
- **live**: starting opens the first *enabled* stage only; the others stay locked.
- **archived**: read-only for everyone. Nobody can join, write, submit or share. Participants can still read their own group's work and the shared board. Restore returns it to where it was.
- **Delete (permanent)**: owner only, from any state, after typing the exact title. See “Deletion” below.
- Joining has its own switch (open/closed) and the join code can be replaced at any time. Neither affects people who already joined.

## Stage (four separate controls)

| Control | Values | Meaning |
|---|---|---|
| Enabled | on / off | Whether the stage is used at all. At least one stage must stay enabled. Three stages are created by default; disable one or two to use fewer. |
| Visible | yes / hidden | Whether participants can see it exists. A hidden or disabled stage answers “not found” to every direct request. |
| Availability | locked → open ⇄ closed | Whether participants can add work. A locked stage shows its title only: no instructions or questions are sent. Closed is read-only. |
| Per-group setting | “same as the part”, open, closed, locked, and “excluded” | One group can be opened or closed alone. An excluded group does not take part and never blocks progress. A group's setting wins over the stage's. |

Permitted availability moves: `locked → open`, `open → closed`, `closed → open`, `open → locked` and `closed → locked` **only if the stage has no entries at all**. Anything else is refused. Opening and closing need the session to be live.

Guarantees (each is tested): opening a stage does not touch earlier stages or entries; opening a stage publishes nothing; submitting does not open the next stage; “closed” beats a reopened submission (the group can read but not write until the stage is opened again).

Opening a later stage while expected groups have not submitted the previous one is refused until the facilitator types a reason; the reason, the person and the missing groups are recorded (“proceed override”). Groups with no members, and groups left out of that stage, are not “expected”.

## Group work, per group and per stage

`draft` → `submitted` → `reopened` → `submitted` (version 2) → …

- **draft**: members add and edit their own entries.
- **submitted**: the submission is atomic. The snapshot is read inside the same write transaction that records it, so every entry the server had acknowledged as saved is in it, and nothing can be added afterwards. It records who submitted and when. Everything becomes read-only for the group. Required guiding questions must have a response, a confirmation is needed, and the same request key (or a second click) cannot create a second version.
- **reopened**: only that group's latest version is reopened by the facilitator. The earlier version is kept unchanged. Other groups and other stages are untouched.
- Resubmitting creates a new version. All versions and the reopen notes are visible to facilitators.

## Publication (selected content only)

`private` → `shared` → (source changes) `shared, flagged “differs from source”` → `updated` or `stopped`.

- Sharing copies a frozen snapshot. Edits to the source stay private until the facilitator updates the shared copy.
- Each shared item has a label mode: **group** (shows the group name only, never the author) or **anonymous** (“Sample Response N”). A bulk switch changes every shared item. A republished item keeps its number.
- Public views are built from an explicit list of fields, so an anonymous item has no name, group, person id or source id anywhere in it.
- Stopping sharing removes access through the application at once. It cannot retract screenshots or anything already downloaded.
- Approval for the projector is a second, separate switch per item.

## AI output (optional)

`draft` → `edited` → `reviewed` → `published` (summaries and comparisons) — or, for discussion questions, `reviewed` → each question revealed or hidden individually.

- Generating always produces a private draft. The model's original is kept untouched; the facilitator's edit is stored separately.
- Edits are checked like the original: only sources from the selected work, and the rules for that output type.
- A draft must be marked reviewed before it can be shared or any question revealed. Sources are validated again at the moment of publishing.
- A draft is “potentially outdated” when the work it used has changed (edited, hidden, deleted, newly added). Publishing never silently replaces earlier shared copies.
- A demo (simulated) draft can be shared only after an explicit acknowledgement, and it stays labelled “Demo: simulated, not real AI.” everywhere, including exports.

## Deletion: what is removed

Permanent deletion of a session removes, in one transaction, every database record of the session: groups, participants and their sign-ins, entries and all their versions, group responses, submissions, shared items, reactions, peer responses, resources, projector settings, AI drafts, and its audit history. The uploaded files (pictures, PDFs) are then deleted from disk. One line is kept in the audit log (who, when, which id, counts; no content).
**Backups made earlier still contain the data** until they are deleted or expire. Duplicated sessions have their own copies of files, so deleting the original does not break a copy.
Removing a participant, hiding an entry or discarding an AI draft is a different, smaller action and is described in the interface where it happens.
