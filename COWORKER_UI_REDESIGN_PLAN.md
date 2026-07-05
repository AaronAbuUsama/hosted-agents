# Coworker UI Redesign Plan

## 0. Working principle

We are not building “agents.”

We are building a product where the customer **hires named coworkers from coworker.tech**.

So the UI language should be:

- **Coworkers**, not agents.
- **Runs**, not jobs.
- **Rules**, not configs.
- **GitHub installations**, not integrations in the abstract.
- **Organizations**, not tenants.
- **Provider account**, not random API key setup.

The app should feel like a control room for a team of named AI coworkers.

Initial coworker roster:

### Abu Bakr

- Role: **Code Review Engineer**
- Identity: `abu-bakr@coworker.tech`
- GitHub App: **Abu Bakr by Coworker**
- Primary surface:
  - PR review rules
  - review runs
  - inline comments
  - merge-blocking checks

### Umar

- Role: **Software Engineer**
- Identity: `umar@coworker.tech`
- GitHub App: **Umar by Coworker**
- Primary surface:
  - issue assignment
  - implementation runs
  - branch/PR creation
  - responding to review feedback

Future coworkers can fit the same model without changing the IA.

## 1. First pass: information architecture before visuals

Define the route tree first, because the current app has no product shape.

Proposed route structure:

```txt
/
  Marketing page

/login
  Sign in

/signup
  Create account

/onboarding
  /onboarding/account
    Create user identity

  /onboarding/organization
    Create/select Coworker organization

  /onboarding/provider
    Connect OpenAI / ChatGPT / Codex account

  /onboarding/github
    Connect GitHub organization

  /onboarding/coworkers
    Choose coworkers to install:
      - Abu Bakr
      - Umar

  /onboarding/rules
    Pick starter rules:
      - review every PR
      - run on assigned issue
      - require passing check before merge

/app
  Dashboard overview

/app/runs
  Runs table

/app/runs/[runId]
  Run detail:
    - timeline
    - chat/history
    - logs
    - GitHub event
    - files/PR/check output

/app/coworkers
  Coworker roster

/app/coworkers/[coworkerId]
  Coworker detail:
    - identity
    - installed GitHub app
    - repos
    - rules
    - recent runs

/app/rules
  Automation rules

/app/rules/new
  Create rule

/app/settings
  Organization settings

/app/settings/github
  GitHub installations

/app/settings/provider
  OpenAI/Codex credentials

/app/settings/billing
  Billing/subscription later
```

This creates a coherent funnel:

```txt
Marketing
   ↓
Auth
   ↓
Org setup
   ↓
Provider credentials
   ↓
GitHub install
   ↓
Choose coworkers
   ↓
Rules
   ↓
Dashboard
   ↓
Runs / coworkers / settings
```

## 2. Product screens to build first

Do not try to build every final backend behavior immediately.

First build a **static-but-realistic IA pass** with fixture data. Not fake as in “pretend backend works”; fixture data as design scaffolding so we can see the actual product.

### A. Marketing page

Job: explain the product in 10 seconds.

Core message:

> Hire named AI coworkers that review, implement, and report from inside GitHub.

Sections:

1. Hero
   - “Your next engineer already has a GitHub account.”
   - CTAs:
     - `Hire your first coworker`
     - `View coworkers`
2. Coworker roster preview
   - Abu Bakr — Code Review Engineer
   - Umar — Software Engineer
3. Workflow
   - Connect provider account
   - Install coworker GitHub Apps
   - Set rules
   - Watch runs
4. Trust/architecture
   - GitHub App identities
   - isolated sandbox runs
   - customer-owned provider credentials
   - check-based merge protection
5. CTA

### B. Signup/signin flow

Use Astryx `login-card` as reference.

Routes:

```txt
/signup
/login
```

Signup should not immediately dump into dashboard.

Signup progression:

```txt
Create account
  ↓
Create/select organization
  ↓
Connect provider account
  ↓
Connect GitHub
  ↓
Install coworkers
  ↓
Create first rule
  ↓
Dashboard
```

Auth methods:

- Email/password now.
- GitHub sign-in soon.
- UI should already reserve space for GitHub auth so it does not look bolted on later.

### C. Onboarding

The product only makes sense after the user connects:

1. Coworker org
2. OpenAI/Codex account
3. GitHub org
4. Named coworkers
5. Automation rules

Onboarding should look like setup for a real team, not a SaaS wizard.

Possible steps:

```txt
Step 1: Your organization
Step 2: Provider account
Step 3: GitHub organization
Step 4: Hire coworkers
Step 5: Starter rules
```

Each step needs a clear “why this matters” explanation.

Example:

> Abu Bakr needs a GitHub App installation so his review comments, checks, and approvals appear as Abu Bakr — not as a generic bot.

### D. Main dashboard

Use Astryx `shell-nav` as the AppShell reference.

Dashboard should answer:

1. Who is installed?
2. What is running?
3. What needs attention?
4. Are credentials/installations healthy?
5. What rules are active?

Dashboard modules:

```txt
Top summary:
  - Active runs
  - Installed coworkers
  - Connected repos
  - Required actions

Main:
  - Recent runs
  - Coworker roster
  - Setup health
  - Rule coverage

Right/secondary:
  - Provider account status
  - GitHub installation status
  - Latest failed run
```

Primary nav:

```txt
Runs
Coworkers
Rules
GitHub
Settings
```

Not “Dashboard / Agents / Jobs / Config.”

### E. Runs table

Use Astryx `table-grouped`.

Runs are the operational heart of the app.

Default grouping should be by **status**, with repo as a column. It surfaces urgency.

Columns:

```txt
Run
Coworker
Trigger
Repository
Branch / PR
Status
Started
Duration
Result
```

Example rows:

```txt
Abu Bakr reviewed PR #482
Umar implementing issue #117
Abu Bakr waiting for CI
Umar opened PR #119
```

Statuses should be product-language statuses:

- Running
- Waiting for GitHub
- Needs review
- Failed
- Completed
- Blocked by credentials
- Blocked by rule

Not generic “pending/success/error” only.

### F. Run detail

Use Astryx `ai-chat`.

This page is critical.

A run detail should have:

```txt
Header:
  - Coworker avatar/name/role
  - Repo/PR/issue
  - Status
  - Primary action

Main split:
  Left: timeline/chat/transcript
  Right: run facts

Tabs or sections:
  - Conversation
  - Timeline
  - Files changed
  - GitHub activity
  - Logs
  - Settings used
```

For a live run:

```txt
Abu Bakr is reviewing PR #482
  ✓ Loaded diff
  ✓ Checked project conventions
  → Writing inline comments
  · Waiting for CI
```

For an implementation run:

```txt
Umar is implementing issue #117
  ✓ Created branch
  ✓ Inspected codebase
  ✓ Edited files
  → Running tests
  · Preparing PR
```

The chat should not just be “chatbot chat.” It should be the run transcript: what the coworker did, decisions made, tool outputs, GitHub events, user messages.

### G. Coworker roster

This replaces generic “agent selection.”

Use a people/team metaphor, but still serious.

Each coworker card:

```txt
Abu Bakr
Code Review Engineer
abu-bakr@coworker.tech

Installed in:
  8 repos

Runs this week:
  42

Default triggers:
  Pull request opened
  Pull request synchronized
  Review requested

Primary actions:
  Configure rules
  View runs
  Open GitHub App
```

For Umar:

```txt
Umar
Software Engineer
umar@coworker.tech

Installed in:
  3 repos

Default triggers:
  Issue assigned
  Comment command
  Review changes requested
```

Important distinction:

- Abu Bakr and Umar are product identities.
- GitHub Apps are their platform identities.
- Rules define when they act.
- Runs are what they actually did.

### H. Rules

Use `settings-sidebar` for the settings/rules style.

Rule model in UI:

```txt
When this happens:
  GitHub event / command / schedule

In these repositories:
  repo selector

For these branches:
  branch selector

Ask this coworker:
  Abu Bakr / Umar

To do this:
  Review PR / Implement issue / Respond to feedback

With these constraints:
  required checks
  max files
  draft mode
  approval required
```

Example rules:

```txt
Review every pull request
Coworker: Abu Bakr
Repos: all production repos
Branches: main, develop
Action: review diff and post required check

Implement assigned issues
Coworker: Umar
Repos: selected repos
Trigger: issue assigned to Umar
Action: create branch and open PR
```

## 3. Astryx template usage

Do not paste templates directly into final routes blindly.

Use them as **reference kits**, then compose the real product.

Because this is a Bun workspace, and the generated Astryx docs say to use `bunx astryx`, use:

```bash
bunx astryx template shell-nav apps/web/src/astryx-reference/shell-nav
bunx astryx template login-card apps/web/src/astryx-reference/login-card
bunx astryx template table-grouped apps/web/src/astryx-reference/table-grouped
bunx astryx template settings-sidebar apps/web/src/astryx-reference/settings-sidebar
bunx astryx template ai-chat apps/web/src/astryx-reference/ai-chat
bunx astryx template kanban-board apps/web/src/astryx-reference/kanban-board
```

Put them in a reference folder first, not directly into real routes, because:

- the existing app is in `apps/web`, not root `./src/app`;
- template routes can pollute the Next app tree if dropped straight into `src/app`;
- we need a coherent product, not six disconnected demo pages;
- we need to extract patterns/components and then build real routes.

Template usage:

| Template | Use |
|---|---|
| `shell-nav` | Main `/app` layout |
| `login-card` | `/login`, `/signup`, provider/GitHub auth cards |
| `table-grouped` | `/app/runs` |
| `settings-sidebar` | `/app/settings`, `/app/rules` |
| `ai-chat` | `/app/runs/[runId]` transcript/live run |
| `kanban-board` | Maybe later for run pipeline or issue queue; not first unless it clearly earns its place |

Be careful with `kanban-board`. It is tempting, but a board may not be right for this product unless we have a real workflow stage model. Runs are probably better as table + timeline first.

## 4. Visual direction

Do not make this look like a generic dark SaaS dashboard.

The visual concept should be:

> A serious desktop operations console for managing named AI coworkers inside GitHub.

Desktop-first. Dense. Calm. More “engineering control room” than “landing page gradient startup.”

### Visual principles

- Named people, not avatars as decoration.
- Operational clarity over marketing gloss.
- Dense tables and timelines.
- Clear status language.
- GitHub-native mental model.
- Good empty states, because initial setup has many missing pieces.

### Signature element

The unique element should be the **coworker identity system**:

Each coworker has:

- name
- role
- email
- GitHub App identity
- avatar/monogram
- check name
- installed repositories
- active rules
- run history

This becomes the thing users remember:

> “I installed Abu Bakr and Umar into my repos.”

Not:

> “I configured two automation agents.”

### Palette

Given Astryx Neutral theme, keep the base restrained and use status/identity accents through tokens, not raw color overrides.

Avoid a neon AI look.

Design target:

- neutral surface system
- strong typography
- status tokens
- coworker identity accents
- GitHub-inspired operational density

### Layout

Desktop app shell:

```txt
┌─────────────────────────────────────────────────────────────┐
│ Top bar: org switcher / search / provider status / user     │
├───────────────┬─────────────────────────────────────────────┤
│ Side nav      │ Page header                                 │
│               │ ┌─────────────────────────────────────────┐ │
│ Runs          │ │ Primary content                         │ │
│ Coworkers     │ │                                         │ │
│ Rules         │ │                                         │ │
│ GitHub        │ └─────────────────────────────────────────┘ │
│ Settings      │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

Run detail:

```txt
┌───────────────┬───────────────────────────────┬─────────────┐
│ Side nav      │ Run transcript / live chat    │ Run facts    │
│               │ Timeline                      │ Repo         │
│               │ Tool output summaries         │ Branch       │
│               │ GitHub comments/checks        │ Rule used    │
└───────────────┴───────────────────────────────┴─────────────┘
```

Coworker detail:

```txt
┌───────────────┬─────────────────────────────────────────────┐
│ Side nav      │ Abu Bakr                                   │
│               │ Code Review Engineer                       │
│               │ GitHub App status                          │
│               ├─────────────────────────────────────────────┤
│               │ Rules                                      │
│               │ Recent runs                                │
│               │ Installed repos                            │
└───────────────┴─────────────────────────────────────────────┘
```

## 5. Implementation process

Do this in controlled passes.

### Pass 1 — Audit current app

Before editing:

- inspect `apps/web` route structure;
- identify current auth routes;
- find global CSS/app entry;
- find existing components;
- find provider/auth wiring;
- understand whether app router, route groups, layouts are already used.

Output of this pass:

```txt
Current route map
Current component map
Files to replace
Files to keep
Files to delete
```

No visual work before that.

### Pass 2 — Generate Astryx references

Run the templates into a reference folder.

Not final routes.

Then read them and extract:

- component names;
- layout structure;
- required imports;
- styling/token conventions;
- accessibility patterns;
- how Astryx expects AppShell/forms/tables/chat to be composed.

Output:

```txt
Astryx component shortlist:
  AppShell
  SideNav
  Button
  Table
  List/Item
  StatusDot/Token
  Form fields
  Chat components
  Settings/sidebar components
```

### Pass 3 — Wire global Astryx foundation

Only after reading the actual app entry.

Need add:

```ts
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
```

Likely in the root web app layout or entry, depending on Next structure.

Also theme-neutral if required by package docs/template output.

This is the point where the app can visually change.

### Pass 4 — Build the new route skeleton

Create real routes with static fixture data:

```txt
/
  marketing

/login
/signup

/onboarding/*
  account
  organization
  provider
  github
  coworkers
  rules

/app/*
  dashboard
  runs
  runs/[runId]
  coworkers
  coworkers/[coworkerId]
  rules
  settings
```

At this stage, no deep backend integration.

But links should work.

The app should be navigable end-to-end.

### Pass 5 — Build fixtures that match the actual product model

Create realistic local fixtures:

```ts
coworkers = [
  {
    id: "abu-bakr",
    name: "Abu Bakr",
    role: "Code Review Engineer",
    email: "abu-bakr@coworker.tech",
    githubAppName: "Abu Bakr by Coworker",
  },
  {
    id: "umar",
    name: "Umar",
    role: "Software Engineer",
    email: "umar@coworker.tech",
    githubAppName: "Umar by Coworker",
  },
]
```

And fixtures for:

- orgs
- provider connection status
- GitHub installations
- rules
- runs
- run messages/timeline

This lets the IA become real before backend wiring.

Make it obvious in code that these are fixtures, not pretend-live data.

### Pass 6 — Build screens in priority order

Order matters.

1. **AppShell**
   - nav
   - org switcher
   - layout
   - page header pattern
2. **Marketing page**
   - tells product story
   - links to signup/login
3. **Auth pages**
   - signup/login
   - GitHub auth placeholder
4. **Onboarding**
   - organization
   - provider
   - GitHub
   - coworker selection
   - rules
5. **Dashboard**
   - installed coworkers
   - active runs
   - setup status
6. **Runs table**
   - grouped table
   - statuses
   - repo/PR/coworker columns
7. **Run detail**
   - chat/timeline
   - live run style
   - GitHub activity
8. **Coworkers**
   - roster
   - detail pages
   - rules/recent runs
9. **Rules/settings**
   - settings-sidebar pattern
   - rule forms

## 6. Visual verification

Look at the app, not just the code.

After each major pass, boot the app and inspect screenshots/routes.

Minimum visual checkpoints:

```txt
/
  Marketing page

/signup
  Signup card

/onboarding/coworkers
  Coworker selection

/app
  Dashboard

/app/runs
  Runs table

/app/runs/demo-run-1
  Run detail + chat/timeline

/app/coworkers
  Coworker roster

/app/rules
  Rules/settings
```

Check:

- Does this actually tell the product story?
- Does the nav make sense?
- Can a new user understand what to do next?
- Does Abu Bakr/Umar feel like named coworkers?
- Are runs legible?
- Are setup blockers obvious?
- Is the app desktop-dense without looking broken?
- Are we avoiding the current “random dark form in empty space” problem?

## 7. What not to do

Do not:

- randomly skin the existing login page;
- paste templates directly into production routes;
- invent backend behavior that does not exist;
- rename product concepts casually;
- create generic “Agent 1 / Agent 2” UI;
- use Astryx as decoration only;
- use Tailwind/raw div layout if Astryx conventions say not to;
- leave a disconnected set of demo pages;
- claim the app works without opening it and looking.

## 8. First deliverable target

The first real deliverable should be:

> A navigable desktop-first product shell with marketing, auth, onboarding, dashboard, runs, run detail, coworkers, and rules — using Astryx components and realistic coworker/run fixtures.

Not fully wired backend yet.

But it should feel like the actual product.

Acceptance criteria for that first pass:

- `/` explains Coworker clearly.
- `/signup` and `/login` look intentional.
- onboarding flow exists and has the right sequence.
- `/app` uses a proper shell/nav.
- `/app/runs` shows realistic grouped runs.
- `/app/runs/[id]` shows chat/timeline/live run detail.
- `/app/coworkers` shows Abu Bakr and Umar as named coworkers.
- `/app/rules` lets the user understand how triggers will work.
- Astryx CSS is wired.
- App visually inspected in browser.
- No route dead-ends in the primary flow.

## 9. Recommended execution plan

```txt
Phase 1: Inspect current app
  - route map
  - layout/app entry
  - auth flow
  - existing components

Phase 2: Generate/read Astryx templates
  - shell-nav
  - login-card
  - table-grouped
  - settings-sidebar
  - ai-chat
  - kanban-board, only as reference

Phase 3: Define fixtures/domain vocabulary
  - coworkers
  - orgs
  - installations
  - provider status
  - rules
  - runs
  - run timeline/messages

Phase 4: Wire Astryx foundation
  - CSS imports
  - theme setup if required
  - app shell base

Phase 5: Build routes
  - marketing
  - auth
  - onboarding
  - dashboard
  - runs
  - run detail
  - coworkers
  - rules/settings

Phase 6: Browser review
  - inspect every key screen
  - screenshot
  - fix obvious layout/design issues

Phase 7: Cleanup
  - remove dead old UI
  - keep fixtures organized
  - ensure route links work
  - run focused verification
```

This is a product redesign, not a component swap.
