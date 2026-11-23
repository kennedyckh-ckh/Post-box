# Permission matrix

Every rule below is enforced **on the server**, in the route code, not by hiding buttons. The list of all 99 endpoints is in `ROUTES.txt` (generated from the running code with `npm run routes`).
The automated test `tests/hardening.test.ts` calls every endpoint with no sign-in, with only a participant's sign-in, and with only a facilitator's sign-in, and fails if anything answers that should not.

**Roles**

| Role | Who | How they sign in |
|---|---|---|
| Visitor | Anyone | Nothing |
| Participant | Someone who joined a session | Cookie set at join, or a private recovery code |
| Co-facilitator | A facilitator account added to a session by its owner | Email and password |
| Owner | The facilitator who created the session | Email and password |
| Administrator | One or more facilitator accounts flagged as administrator (the first is created from private host settings) | Email and password |

An administrator has **no automatic access to any session**. Their extra powers are only: create, disable and reset facilitator accounts, set the AI limits, and see everyone's AI usage.
A facilitator reaches a session only if they own it or were explicitly added. Anything else answers “not found”, so session ids do not leak.

**How to read it:** Yes = allowed. Own = only their own item. – = refused (401/403/404).
“Participant (own group)” means an active member of that group in a session that is not archived.

## Joining and access

| Action | Visitor | Participant (own group) | Participant (other group) | Co-fac. | Owner | Admin |
|---|---|---|---|---|---|---|
| Look up a join code (title, group names, seats left; never PINs or members) | Yes (rate-limited) | n/a | n/a | n/a | n/a | n/a |
| Join with code (+ PIN if the group has one) | Yes, if joining open and a seat is free (rate-limited) | n/a | n/a | n/a | n/a | n/a |
| Recover with the private recovery code | Yes (rate-limited) | n/a | n/a | n/a | n/a | n/a |
| View own recovery code (from own signed-in device) | – | Own | – | – | – | – |
| Replace own recovery code | – | Own | – | – | – | – |
| Issue a participant a new recovery code (old code and devices stop working) | – | – | – | Yes | Yes | – |
| Close/open joining, new join code | – | – | – | Yes | Yes | – |
| Move, remove, restore participants | – | – | – | Yes | Yes | – |
| Set group PIN, seat cap, representative; add/remove groups | – | – | – | Yes | Yes | – |
| Add or remove co-facilitators | – | – | – | – | Yes | – |

## Stages and the participant workspace

| Action | Visitor | Participant (own group) | Participant (other group) | Co-fac. | Owner | Admin |
|---|---|---|---|---|---|---|
| Edit stage settings, questions, links, files; open/close/lock; per-group override and exclusion | – | – | – | Yes | Yes | – |
| Read a stage's instructions and questions | – | Only if the stage is enabled, visible and (for their group) open or closed; never when locked, hidden or disabled | Same, for their own group | Yes | Yes | – |
| Read the group's entries | – | Yes (hidden entries excluded) | – (they see only their own group's) | Yes (including hidden) | Yes | – |
| Add an entry or upload a picture | – | Only while the stage is open for the group, the session is live and the group has not submitted | – | – | – | – |
| Edit or delete an entry | – | Own entries only, under the same conditions | – | – (can hide) | – (can hide) | – |
| Hide or unhide an entry | – | – | – | Yes | Yes | – |
| Edit the group response | – | Any member, same conditions as entries | – | – | – | – |
| Submit group work | – | Any member, or only the representative if the session says so | – | – | – | – |
| Reopen one group's submission | – | – | – | Yes | Yes | – |
| See progress, versions, audit history | – | – | – | Yes | Yes | – |
| Download a participant's picture | – | Own group | Only through a currently shared item, under a generic file name | Yes | Yes | – |
| Download a facilitator's file | – | Once the stage it belongs to is open or closed for their group | Same, for their own group | Yes | Yes | – |

## Sharing, reactions, projector, export

| Action | Visitor | Participant (own group) | Participant (other group) | Co-fac. | Owner | Admin |
|---|---|---|---|---|---|---|
| Publish, update or stop sharing an entry or submission | – | – | – | Yes | Yes | – |
| Approve an item for the projector; create or revoke the projector link | – | – | – | Yes | Yes | – |
| See the shared items (class board) | – | Yes | Yes | Yes | Yes | – |
| See the projector page | Only with the secret link | n/a | n/a | n/a | n/a | n/a |
| Open the signed-in projector view; reveal or hide guiding questions | – | – | – | Yes | Yes | – |
| React to an entry in the group | – | Yes, if reactions are on for groups | – | – | – | – |
| React to a shared item | – | Yes, if on for shared items | Yes | – | – | – |
| Respond to a peer's entry / a shared item | – | Yes (not to their own entry) | Shared items only | – | – | – |
| Approve or hide peer responses | – | – | – | Yes | Yes | – |
| Change reaction / peer response settings | – | – | – | Yes | Yes | – |
| Export (identified or de-identified) | – | – | – | Yes | Yes | – |
| Duplicate or archive/restore a session | – | – | – | Yes | Yes | – |
| Permanently delete a session | – | – | – | – | Yes (must type the exact title) | – |

## AI (optional)

| Action | Visitor | Participant | Co-fac. | Owner | Admin |
|---|---|---|---|---|---|
| Preview scope, generate, edit, review, publish, reveal, inspect sources, discard | – | – | Yes (their session) | Yes (their session) | Only if also a facilitator of that session |
| See own AI usage, test the connection | – | – | Yes | Yes | Yes |
| See everyone's AI usage; set the limits | – | – | – | – | Yes |

The AI component only returns text. It has no access to membership, stage release, publication, deletion or any other session; every decision stays in the routes above.

## Accounts

| Action | Anyone else | Facilitator | Admin |
|---|---|---|---|
| Create a facilitator account, reset a password, disable an account | – | – | Yes |
| Change own password | – | Yes | Yes |
