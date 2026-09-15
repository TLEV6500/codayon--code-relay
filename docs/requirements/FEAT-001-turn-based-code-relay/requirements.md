# FEAT-001 — Turn-Based Code Relay (Foundation Slice)

## 1. Introduction

### 1.1 Product Context

Codayon is a gamified, turn-based collaborative code relay platform serving
educational workshops, mentorship, and learning (~70%) and interactive
team-building coding relays (~30%). The name combines "code" with the Cebuano
word *dayon* — "code right now" (instant in-browser execution and sync) and
"come in / welcome" (an inviting environment for collaborative learning).

This document specifies **FEAT-001**, the first vertical slice: the
**collaboration and turn-based relay backbone with a minimal shared editor**.
In a Codayon session, exactly one participant — the **Driver** — holds the
**edit token** during a time-bound **turn** and has active typing control.
Everyone else watches live in read-only mode, seeing cursors, selections, and
edits as they happen. Control passes between participants as turns advance.

Requirements in this document are **implementation-agnostic** and behavioral.
Acceptance criteria are written in the EARS style (WHEN/IF … THE SYSTEM SHALL …).
This document does not mandate a specific synchronization algorithm (e.g.,
Operational Transformation vs. CRDT), editor engine, network transport, or
application framework. Any technology references are non-binding context notes
to be resolved during design, not requirements.

### 1.2 In Scope

- A real-time multiplayer **session** hosted in a **room**, joinable via a room
  code or link.
- **Fully ephemeral identity.** No persistent accounts. The Host is
  distinguished by an ephemeral, session-scoped **host-ownership token**, not a
  durable account. Participants and spectators join anonymously via the room
  code/link.
- **Roles:** Host (may act as admin-only or as host + participant), Driver
  (current edit-token holder), Observer (participant eligible for the Driver
  rotation), Spectator (watch-only; never drives).
- **Turn modes:** fixed-duration turns, and fixed-duration turns with an
  optional early-end.
- **Driver selection:** the Host chooses, per session, either automatic
  round-robin rotation or manual pass. Round-robin order is recalculated fairly
  to include participants who join after the session starts.
- **Connectivity:** online remote collaboration via a single **authoritative
  relay** server.
- **Minimal editor:** a shared single document with syntax highlighting and live
  read-only presence (cursors, selections, edits). No autocomplete, no
  execution.
- **Driver mid-turn disconnect handling:** the Host is prompted to decide
  (reassign / extend / skip), with a defined safe default when the Host is
  unavailable.

### 1.3 Out of Scope (deferred to future specifications)

The following are explicitly **not** part of FEAT-001:

- **In-browser execution**, stateful REPL, client-side transpilation, and the
  sandboxed WebAssembly/Web Worker runtime.
- **Semantic IntelliSense / autocomplete** (only syntax highlighting is in
  scope).
- **Offline support**, client-side edit caching, and background reconnection
  persistence.
- **LAN / peer-to-peer transport.** Documented in this spec only as a
  forward-compatible constraint (see NFR-006); not implemented in this slice.
- **Persistent accounts** and any history/progress association to identities.
- **Gamification** (points, badges, streaks, achievements, leaderboards).
- **Single-line turn mode** (only fixed-duration and fixed-duration-with-early-
  end are in scope).
- **Any post-session persistence.** The session is ephemeral: once it ends, no
  document, transcript, turn history, or participant record is retained.

### 1.4 Non-Binding Design Context

The following observations inform design but are **not** requirements:

- Authoritative document state and transient **presence** data (cursors,
  selections) are best treated as separate channels; presence is awareness data,
  not part of the authoritative document.
- Optimistic local application of edits combined with authoritative server
  reconciliation is a common way to achieve low typing latency while guaranteeing
  convergence.
- Anchoring cursors/selections to **logical positions** rather than absolute
  character offsets is a recognized technique for preventing cursor drift across
  concurrent edits and token handoffs.
- OT and CRDT are both viable convergence strategies; the choice is deferred to
  design.

## 2. Glossary

| Term | Definition |
|------|------------|
| **Session** | A single, time-bounded collaborative relay instance with a document, a set of participants, a turn configuration, and a lifecycle (created → active → ended). Ephemeral. |
| **Room** | The joinable container for a session, identified by a room code and/or shareable link. |
| **Room Code / Link** | The credential used to join a room. Possession of a valid, active room code/link grants entry as a participant or spectator. |
| **Host** | The role holding session-administration authority for a session. May operate as admin-only or as host + participant. |
| **Host-Ownership Token** | An ephemeral, session-scoped credential that authorizes host-administration actions. Not a durable account. Exists only for the lifetime of the session. |
| **Driver** | The single participant currently holding the edit token and having active typing control during a turn. |
| **Observer** | A participant who is not currently the Driver but is eligible to become the Driver in the rotation. |
| **Spectator** | A watch-only attendee who sees the document and presence but is never eligible to hold the edit token or mutate the document. |
| **Edit Token** | The single, exclusive grant of write control over the shared document. Held by exactly one Driver at a time. |
| **Turn** | A time-bound interval during which one Driver holds the edit token. |
| **Turn Mode** | The turn-timing policy for the session: fixed-duration, or fixed-duration with optional early-end. |
| **Round-Robin** | An automatic driver-selection policy that rotates the edit token through eligible participants in a defined order. |
| **Manual Pass** | A driver-selection policy in which the Host explicitly assigns/passes the edit token each turn. |
| **Presence** | Transient awareness data broadcast for each connected user: cursor position, selection range, and live edit activity. Not part of the authoritative document. |
| **Authoritative Relay** | The single server authority that orders edits, reconciles client state, and is the source of truth for document and session state. |
| **Convergence** | The guarantee that all connected clients eventually display the identical document content, with no accepted edit silently lost. |
| **Logical Position Anchoring** | Representing cursor/selection positions relative to logical document positions rather than absolute character offsets, so anchors remain stable across edits and token handoffs. |

## 3. Personas

- **Mentor / Host (EdTech primary).** Runs a workshop or mentoring session.
  Creates the room, configures turn mode and driver-selection policy, controls
  pacing, and resolves disruptions (e.g., a driver disconnecting). May teach as
  an admin-only observer of the relay, or participate in the rotation as a
  Driver too.
- **Student / Participant.** Joins a room via code/link to take coding turns.
  Drives when holding the edit token; otherwise observes teammates live. In
  team-building sessions this persona is a peer teammate.
- **Spectator.** Joins to watch only — e.g., an auditing mentor, a reviewer, or
  audience members in a team-building event. Sees the document and presence but
  never drives.

## 4. Functional Requirements

Acceptance criteria use EARS keywords: **WHEN** (event-driven), **WHILE**
(state-driven), **IF/THEN** (conditional), and **SHALL** (mandatory behavior).

### 4.1 Session & Room Lifecycle

#### REQ-001 — Create and host a session
**User story:** As a Mentor/Host, I want to create a session and become its
host, so that I can run a turn-based relay for my group.

Acceptance criteria:
1. WHEN a user requests to create a new session, THE SYSTEM SHALL create a room,
   generate a joinable room code and shareable link, and issue that user an
   ephemeral host-ownership token scoped to the session.
2. WHEN a session is created, THE SYSTEM SHALL require the creator to indicate
   whether they participate as host + participant or as admin-only host before
   the first turn starts.
3. THE SYSTEM SHALL treat the host-ownership token as valid only for the
   lifetime of the session and SHALL NOT persist it after the session ends.
4. IF session creation cannot be completed, THEN THE SYSTEM SHALL report the
   failure to the requesting user and SHALL NOT create a partially initialized
   room.

#### REQ-002 — Join a room via code or link
**User story:** As a Student/Participant or Spectator, I want to join a room
using a code or link, so that I can take part without creating an account.

Acceptance criteria:
1. WHEN a user submits a valid, active room code or link, THE SYSTEM SHALL admit
   the user to the session without requiring account creation.
2. WHEN a user submits an invalid, expired, or ended room code or link, THE
   SYSTEM SHALL deny entry and SHALL inform the user that the room is
   unavailable.
3. WHEN a user is admitted, THE SYSTEM SHALL prompt them to join as a
   participant (Observer, eligible for the rotation) or as a Spectator
   (watch-only).
4. WHEN a user is admitted, THE SYSTEM SHALL provide them the current
   authoritative document state and current presence so their view matches other
   connected users.

#### REQ-003 — Ephemeral identity
**User story:** As any attendee, I want to participate without a persistent
account, so that joining is frictionless for workshops and events.

Acceptance criteria:
1. THE SYSTEM SHALL identify each attendee by an ephemeral, session-scoped
   identifier only.
2. THE SYSTEM SHALL NOT require account creation or persistent credentials to
   host, participate in, or spectate a session in this slice.
3. WHEN a session ends, THE SYSTEM SHALL invalidate all ephemeral identifiers
   and the host-ownership token for that session.

#### REQ-004 — Ephemeral session teardown
**User story:** As a Host, I want the session to end cleanly with nothing
retained, so that no participant data lingers after the activity.

Acceptance criteria:
1. WHEN the Host ends the session, or WHEN the session's terminating condition is
   reached, THE SYSTEM SHALL transition the session to ended and SHALL revoke all
   participants' edit-token eligibility.
2. WHEN a session ends, THE SYSTEM SHALL NOT retain the document content, turn
   history, presence data, participant records, or room code/link for later
   retrieval.
3. WHEN a session has ended, THE SYSTEM SHALL reject any subsequent attempt to
   join or act in that session.

### 4.2 Roles & Authorization

#### REQ-005 — Host administration authority
**User story:** As a Host, I want exclusive control over session administration,
so that only I can change turn settings and resolve disruptions.

Acceptance criteria:
1. THE SYSTEM SHALL restrict session-administration actions (configuring turn
   mode, configuring driver-selection policy, starting/advancing turns,
   reassigning/extending/skipping turns, and ending the session) to the holder of
   the host-ownership token.
2. WHEN a user without the host-ownership token attempts a
   session-administration action, THE SYSTEM SHALL reject the action.
3. THE SYSTEM SHALL support the Host operating either as admin-only (never
   eligible for the edit token) or as host + participant (eligible for the edit
   token in the rotation), per the choice recorded at session creation.

#### REQ-006 — Observer vs. Spectator enforcement
**User story:** As a Host, I want spectators to be strictly watch-only, so that
only intended participants can take coding turns.

Acceptance criteria:
1. THE SYSTEM SHALL treat every attendee as exactly one of: Host, Observer, or
   Spectator (the Driver is the Observer or host+participant who currently holds
   the edit token).
2. THE SYSTEM SHALL NOT ever grant the edit token to a Spectator.
3. WHILE a user holds the Spectator role, THE SYSTEM SHALL present the document
   as read-only and SHALL exclude that user from the Driver rotation.
4. IF a Spectator attempts to acquire the edit token or mutate the document,
   THEN THE SYSTEM SHALL deny the attempt (see REQ-014).

### 4.3 Turn Engine

#### REQ-007 — Configure turn mode
**User story:** As a Host, I want to choose how turns are timed, so that pacing
fits my activity.

Acceptance criteria:
1. THE SYSTEM SHALL allow the Host to configure the session turn mode as either
   (a) fixed-duration, or (b) fixed-duration with optional early-end.
2. THE SYSTEM SHALL allow the Host to set the turn duration for the chosen mode
   before turns begin.
3. IF no turn mode is configured, THEN THE SYSTEM SHALL NOT start the first turn
   and SHALL prompt the Host to complete configuration.

#### REQ-008 — Configure driver-selection policy
**User story:** As a Host, I want to choose how the edit token moves between
participants, so that I can run either an automatic rotation or a manually
controlled relay.

Acceptance criteria:
1. THE SYSTEM SHALL allow the Host to configure driver selection as either
   automatic round-robin or manual pass, per session.
2. WHILE the policy is round-robin, THE SYSTEM SHALL determine the next Driver
   automatically from the rotation order (see REQ-011).
3. WHILE the policy is manual pass, THE SYSTEM SHALL require the Host to assign
   the next Driver for each turn.

#### REQ-009 — Start and advance turns
**User story:** As a Host, I want turns to start and advance in order, so that
control passes predictably.

Acceptance criteria:
1. WHEN the Host starts the session, THE SYSTEM SHALL begin the first turn by
   granting the edit token to the selected Driver and starting the turn timer.
2. WHILE a turn is active, THE SYSTEM SHALL grant the edit token to exactly one
   Driver (see REQ-012).
3. WHEN a turn ends (by timer expiry, valid early-end, or host action), THE
   SYSTEM SHALL revoke the edit token from the current Driver and grant it to the
   next Driver as determined by the active driver-selection policy.

#### REQ-010 — Turn timer and early-end
**User story:** As a Driver, I want a clear turn timer and, when enabled, the
ability to end my turn early, so that the relay stays on pace.

Acceptance criteria:
1. WHILE a turn is active, THE SYSTEM SHALL display the remaining turn time to
   all connected users.
2. WHEN the turn timer reaches zero, THE SYSTEM SHALL end the current turn and
   advance per REQ-009.
3. WHILE the session turn mode is fixed-duration with optional early-end, THE
   SYSTEM SHALL allow the current Driver to end their turn before the timer
   expires.
4. IF the current Driver attempts to end their turn early WHILE the session turn
   mode is fixed-duration (without early-end), THEN THE SYSTEM SHALL reject the
   request and keep the turn active until the timer expires or the Host acts.

#### REQ-011 — Fair round-robin with late-comer recalculation
**User story:** As a Host, I want late joiners folded fairly into the rotation,
so that everyone gets comparable turns.

Acceptance criteria:
1. WHILE the driver-selection policy is round-robin, THE SYSTEM SHALL maintain a
   deterministic rotation order over the current eligible participants.
2. WHEN a participant joins as an Observer after the session has started, THE
   SYSTEM SHALL recalculate the rotation order to include the new participant in a
   fair position, without granting them the edit token before existing
   participants who have not yet driven in the current cycle.
3. WHEN an eligible participant leaves, THE SYSTEM SHALL remove them from the
   rotation order and continue the rotation without granting the edit token to an
   absent participant.
4. THE SYSTEM SHALL apply rotation recalculation without interrupting the
   currently active turn.

### 4.4 Edit Token & Control

#### REQ-012 — Exactly-one-driver invariant
**User story:** As a participant, I want only one person to type at a time, so
that the "pass-the-keyboard" relay is unambiguous.

Acceptance criteria:
1. THE SYSTEM SHALL ensure that at most one edit token exists for a session at
   any time.
2. WHILE a turn is active, THE SYSTEM SHALL grant write control over the document
   exclusively to the current edit-token holder.
3. WHEN the edit token is transferred, THE SYSTEM SHALL revoke write control from
   the previous holder before or atomically with granting it to the next holder,
   such that no two users ever hold write control simultaneously.

#### REQ-013 — Read-only enforcement for non-drivers
**User story:** As a non-driving participant, I want my editor to be read-only,
so that I cannot accidentally alter the document during someone else's turn.

Acceptance criteria:
1. WHILE a user does not hold the edit token, THE SYSTEM SHALL present the shared
   document to that user in read-only mode.
2. IF a non-driver's client submits a document mutation, THEN THE SYSTEM SHALL
   reject the mutation at the authoritative relay and SHALL NOT apply it to the
   authoritative document.
3. THE SYSTEM SHALL enforce read-only status at the authoritative relay and
   SHALL NOT rely solely on client-side controls.

#### REQ-014 — Unauthorized edit denial
**User story:** As a Host, I want unauthorized edit attempts blocked, so that
role boundaries hold even under a misbehaving client.

Acceptance criteria:
1. IF a Spectator or any non-token-holder attempts to acquire the edit token,
   THEN THE SYSTEM SHALL deny the request.
2. IF a Spectator or any non-token-holder attempts to mutate the document, THEN
   THE SYSTEM SHALL reject the mutation and leave the authoritative document
   unchanged.
3. WHEN THE SYSTEM denies an unauthorized action, THE SYSTEM SHALL keep the
   session and document state consistent for all other connected users.

#### REQ-015 — Drift-free token handoff
**User story:** As the next Driver, I want my cursor and the document to stay
consistent when I receive control, so that handoffs don't scramble positions.

Acceptance criteria:
1. WHEN the edit token is handed off, THE SYSTEM SHALL preserve each connected
   user's cursor and selection relative to logical document positions, so that
   anchors are not displaced by the handoff itself.
2. WHEN edits occur before, during, or immediately after a handoff, THE SYSTEM
   SHALL maintain each user's cursor/selection anchor at its intended logical
   position rather than a stale absolute offset.
3. WHEN a handoff completes, THE SYSTEM SHALL ensure all connected clients
   display identical document content (see REQ-017).

### 4.5 Real-Time Sync & Presence

#### REQ-016 — Live edit propagation
**User story:** As a participant, I want to see the Driver's edits in real time,
so that everyone follows the same code as it is written.

Acceptance criteria:
1. WHEN the Driver mutates the document, THE SYSTEM SHALL propagate the edit to
   all connected participants and spectators.
2. THE SYSTEM SHALL apply the Driver's local edits optimistically for the Driver
   while reconciling against the authoritative relay's ordering.
3. WHEN the authoritative relay accepts an edit, THE SYSTEM SHALL order it
   consistently for all clients.

#### REQ-017 — Convergence guarantee
**User story:** As a participant, I want everyone's view to match, so that no
one is looking at diverged or lost code.

Acceptance criteria:
1. WHEN all pending edits have been reconciled, THE SYSTEM SHALL ensure every
   connected client displays identical document content.
2. THE SYSTEM SHALL NOT silently drop any edit that the authoritative relay has
   accepted.
3. IF concurrent inputs occur, THEN THE SYSTEM SHALL resolve them to a single
   consistent authoritative state applied to all clients.

#### REQ-018 — Live presence (cursors and selections)
**User story:** As a participant or spectator, I want to see teammates' cursors
and selections, so that I can follow the Driver's focus.

Acceptance criteria:
1. WHILE a user is connected, THE SYSTEM SHALL broadcast that user's cursor
   position and selection range as presence to all other connected users.
2. THE SYSTEM SHALL present presence to Spectators as well as participants.
3. THE SYSTEM SHALL treat presence as transient awareness data separate from the
   authoritative document and SHALL NOT persist it after the session ends.
4. WHEN a user disconnects, THE SYSTEM SHALL remove that user's presence
   indicators for other users.

### 4.6 Minimal Editor

#### REQ-019 — Shared document with syntax highlighting
**User story:** As a participant, I want a readable, highlighted editor, so that
code is easy to follow during the relay.

Acceptance criteria:
1. THE SYSTEM SHALL present a single shared document in a browser editor with
   syntax highlighting.
2. THE SYSTEM SHALL provide syntax highlighting for TypeScript, JavaScript, Bash,
   PowerShell, HTML, CSS, Python, SQL, JSON, YAML, and TOML.
3. THE SYSTEM SHALL be extensible to additional languages without requiring
   changes to the relay or turn engine.
4. THE SYSTEM SHALL NOT provide autocomplete, semantic IntelliSense, or code
   execution in this slice.

## 5. Edge Cases & Failure Modes

#### REQ-020 — Driver disconnects mid-turn
**User story:** As a Host, I want a clear, safe response when the active Driver
drops, so that the relay recovers without chaos or a stuck turn.

Acceptance criteria:
1. WHEN the current Driver disconnects during an active turn, THE SYSTEM SHALL
   pause the turn timer and hold the edit token for a defined grace period.
2. WHEN the Driver disconnects mid-turn, THE SYSTEM SHALL prompt the Host to
   choose to reassign the turn to another eligible participant, extend/hold for
   the disconnected Driver, or skip to the next Driver.
3. IF the disconnected Driver reconnects within the grace period AND the Host has
   not acted, THEN THE SYSTEM SHALL restore the edit token to that Driver and
   resume the turn timer.
4. IF the grace period elapses without the Host responding AND the
   driver-selection policy is round-robin, THEN THE SYSTEM SHALL auto-advance the
   edit token to the next eligible participant.
5. IF the grace period elapses without the Host responding AND the
   driver-selection policy is manual pass, THEN THE SYSTEM SHALL keep the turn
   paused and the edit token held until the Host acts.

#### REQ-021 — Non-driver disconnect and rejoin
**User story:** As an Observer or Spectator, I want to drop and rejoin without
disrupting the session, so that connectivity blips don't derail the group.

Acceptance criteria:
1. WHEN an Observer or Spectator disconnects, THE SYSTEM SHALL continue the
   active turn uninterrupted and SHALL remove that user's presence for others.
2. WHEN an Observer who is in the rotation disconnects, THE SYSTEM SHALL treat
   them per REQ-011 (skipped while absent) without stalling the rotation.
3. WHEN a previously connected user rejoins before the session ends, THE SYSTEM
   SHALL provide them the current authoritative document and current presence.

#### REQ-022 — Host disconnect
**User story:** As participants, we want the session to remain coherent if the
Host drops, so that a host blip doesn't corrupt or orphan the session.

Acceptance criteria:
1. WHEN a host + participant Host disconnects while holding the edit token, THE
   SYSTEM SHALL apply the driver mid-turn disconnect handling of REQ-020.
2. WHILE the Host is disconnected, THE SYSTEM SHALL retain the host-ownership
   token binding for the grace period so the Host can resume administration on
   reconnect.
3. IF the Host does not reconnect within the grace period, THEN THE SYSTEM SHALL
   apply the safe default of REQ-020 for any active turn and SHALL keep the
   session in a consistent state pending host return or session end.

#### REQ-023 — Reconnection resync and reconciliation
**User story:** As a returning user, I want to be resynced correctly on
reconnect, so that I converge with everyone else and no edits are lost.

Acceptance criteria:
1. WHEN a user reconnects, THE SYSTEM SHALL reconcile their client to the current
   authoritative document state such that they converge with all other clients
   (see REQ-017).
2. WHEN a user reconnects, THE SYSTEM SHALL restore their correct role, edit-token
   eligibility, and read-only/write status as of the current session state.
3. THE SYSTEM SHALL NOT lose any authoritative-relay-accepted edit as a result of
   a disconnect/reconnect cycle.

#### REQ-024 — Early-end vs. timer-expiry race
**User story:** As a participant, I want a deterministic outcome when an
early-end and the timer expiry happen at nearly the same moment, so that turn
transitions are never ambiguous or doubled.

Acceptance criteria:
1. IF a valid early-end request and turn-timer expiry occur concurrently, THEN
   THE SYSTEM SHALL resolve the turn end exactly once and advance to exactly one
   next turn.
2. THE SYSTEM SHALL NOT double-advance the rotation or grant the edit token to
   two next Drivers as a result of the race.
3. WHEN the race is resolved, THE SYSTEM SHALL leave all clients converged on the
   same subsequent turn state.

#### REQ-025 — Late-comer rotation insertion
**User story:** As a Host, I want participants who arrive mid-session inserted
fairly, so that late joiners neither jump the queue nor are excluded.

Acceptance criteria:
1. WHEN a participant joins mid-session as an Observer, THE SYSTEM SHALL insert
   them into the round-robin order per REQ-011 without interrupting the active
   turn.
2. THE SYSTEM SHALL NOT grant a late joiner the edit token ahead of existing
   eligible participants who have not yet driven in the current cycle.

## 6. Non-Functional Requirements

#### NFR-001 — Edit and presence propagation latency
1. WHILE participants are on a healthy network connection, THE SYSTEM SHALL
   propagate a Driver's accepted edit to other connected clients within 250 ms at
   the 95th percentile.
2. WHILE participants are on a healthy network connection, THE SYSTEM SHALL
   propagate presence updates (cursor/selection) within 250 ms at the 95th
   percentile.
3. THE SYSTEM SHALL keep local typing responsive for the Driver via optimistic
   local application (see REQ-016), independent of round-trip latency.

#### NFR-002 — Convergence under concurrency and reconnection
1. THE SYSTEM SHALL guarantee that all connected clients converge to identical
   document content after reconciliation (see REQ-017, REQ-023), with no
   authoritative-relay-accepted edit lost.

#### NFR-003 — Mobile-responsive editor
1. THE SYSTEM SHALL present the editor canvas responsively across desktop and
   mobile browser viewports, remaining usable for reading and driving on small
   screens.

#### NFR-004 — Syntax highlighting coverage and extensibility
1. THE SYSTEM SHALL provide syntax highlighting for the languages listed in
   REQ-019 and SHALL be extensible to additional languages without changes to the
   relay or turn engine.

#### NFR-005 — Edit-token authorization and security
1. THE SYSTEM SHALL enforce that only the current edit-token holder can mutate the
   authoritative document, enforced server-side at the authoritative relay and
   not solely on the client (see REQ-013, REQ-014).
2. THE SYSTEM SHALL scope the host-ownership token to a single session and SHALL
   invalidate it on session end.

#### NFR-006 — Forward-compatible LAN/peer transport (constraint, not implemented)
1. THE SYSTEM's session, role, turn, edit-token, and presence behaviors SHALL be
   specified independently of the specific network transport, so that a future
   LAN / peer-to-peer transport can be introduced without changing these
   behavioral requirements.
2. THE SYSTEM SHALL NOT implement LAN / peer-to-peer transport in this slice.

## 7. Requirements Index

| ID | Title | Group |
|----|-------|-------|
| REQ-001 | Create and host a session | Session & Room Lifecycle |
| REQ-002 | Join a room via code or link | Session & Room Lifecycle |
| REQ-003 | Ephemeral identity | Session & Room Lifecycle |
| REQ-004 | Ephemeral session teardown | Session & Room Lifecycle |
| REQ-005 | Host administration authority | Roles & Authorization |
| REQ-006 | Observer vs. Spectator enforcement | Roles & Authorization |
| REQ-007 | Configure turn mode | Turn Engine |
| REQ-008 | Configure driver-selection policy | Turn Engine |
| REQ-009 | Start and advance turns | Turn Engine |
| REQ-010 | Turn timer and early-end | Turn Engine |
| REQ-011 | Fair round-robin with late-comer recalculation | Turn Engine |
| REQ-012 | Exactly-one-driver invariant | Edit Token & Control |
| REQ-013 | Read-only enforcement for non-drivers | Edit Token & Control |
| REQ-014 | Unauthorized edit denial | Edit Token & Control |
| REQ-015 | Drift-free token handoff | Edit Token & Control |
| REQ-016 | Live edit propagation | Real-Time Sync & Presence |
| REQ-017 | Convergence guarantee | Real-Time Sync & Presence |
| REQ-018 | Live presence (cursors and selections) | Real-Time Sync & Presence |
| REQ-019 | Shared document with syntax highlighting | Minimal Editor |
| REQ-020 | Driver disconnects mid-turn | Edge Cases & Failure Modes |
| REQ-021 | Non-driver disconnect and rejoin | Edge Cases & Failure Modes |
| REQ-022 | Host disconnect | Edge Cases & Failure Modes |
| REQ-023 | Reconnection resync and reconciliation | Edge Cases & Failure Modes |
| REQ-024 | Early-end vs. timer-expiry race | Edge Cases & Failure Modes |
| REQ-025 | Late-comer rotation insertion | Edge Cases & Failure Modes |
| NFR-001 | Edit and presence propagation latency | Non-Functional |
| NFR-002 | Convergence under concurrency and reconnection | Non-Functional |
| NFR-003 | Mobile-responsive editor | Non-Functional |
| NFR-004 | Syntax highlighting coverage and extensibility | Non-Functional |
| NFR-005 | Edit-token authorization and security | Non-Functional |
| NFR-006 | Forward-compatible LAN/peer transport (constraint) | Non-Functional |
