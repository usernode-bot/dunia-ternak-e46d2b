# Dunia Ternak — notes for Claude Code

This app runs on **Homeroom**. The platform conventions are the single
source of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.):

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

**Inside Homeroom** (its dev chat, and Homeroom bot's builds), do not
fetch that URL: what applies to your change is already in your
instructions, and the `homeroom` MCP server's
`get_platform_conventions` reads any one section of the conventions
when you need it. The two sections below are for working outside
Homeroom; skip them there.

**Anywhere else** (Claude Code run against this repo locally, or another
harness), fetch it at the start of each session. The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

## Connector permission prompts (outside Homeroom)

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) once you accept the workspace trust dialog.
See `.claude/README.md` for the whole story, including what to do if you
are still being prompted.

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom (its dev
chat, and Homeroom bot's builds) the platform fixes the base commit, and none
of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Dunia Ternak

Panduan ternak untuk peternak kecil

TernakKu is a livestock guide for small farmers in Indonesia, in Indonesian.
One screen with three tabs: a searched and filtered FAQ of 15 common
questions, a shared forum where farmers post questions and replies under a
nickname typed each time, and a short AI chat (Tanya AI). Answers stay
general and point to a vet or the dinas peternakan for serious, emergency or
contagious cases. Farmers often read on a weak-signal phone: keep the page
light, the text large and the buttons big.

## Your people's data

`usernode-user-data.js` erases a person's rows when they delete their
Homeroom account, and exports them when they ask for a copy. By default it
covers every table with a `user_id` (or `usernode_pubkey`) column. When
you add a table that keys a person's rows another way (`author_id`), add it
to `OWNED_BY`; when a table's `user_id` is not the person the row is
about, add it to `SKIP`. Keep the file and its mount in `server.js`.

## Design

This app's look. The first real version fills in the blanks; every later
change follows it, and updates it when a request changes the look on purpose.

- **Palette:** accent: soft field green; neutrals: cream and warm greys;
  animal markers: straw yellow (goats and sheep, `straw` / `straw-bg`),
  earth brown (cattle, `earth` / `earth-bg`), and green on the raised ground
  for chickens and the barn for Umum. Light and dark values are the tokens
  in `styles/tailwind-input.css`; the dark look keeps each hue.
- **Signature element:** a round marker on every FAQ question and forum post
  holding a line drawing of the animal's head (cow, goat, hen) or a small
  barn for Umum.
- **Type scale:** `text-title` (28/36), `text-heading` (20/28),
  `text-body` (18/26), `text-small` (16/22). Body text is 18 px on purpose.
- **Layout:** the header says TernakKu, the tab's content scrolls, and a
  fixed footer ("Informasi umum, bukan pengganti dokter hewan.") sits above
  a 64 px tab bar. Buttons and fields are at least 48 px tall.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`page-column`, `btn-primary`, `btn-secondary`, `field`, `list`, `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Each screen sits in `page-column`, one centred column on a wide window.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry. Loading has the content's
  own shape (its rows, with `skeleton` bars for their text).
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.
- A header that shows the app's own mark shows the project's icon there
  (the emoji in `dapp.json`'s `icon` block) or no mark at all: never an
  empty tile, and never `brand/icon.png`, which the app does not serve.

## App-specific conventions

- The 15 FAQ answers live in `public/index.html` as the `FAQ` array: they
  are app content, not stored rows.
- The forum is one shared board. Posts carry a nickname typed each time;
  Homeroom's account (`user_id`) decides who may remove a post or reply.
  `forum_reports` only records reports; nothing is hidden automatically.
- A post or reply may carry one livestock photo. The page takes it from the
  phone camera (`<input capture>`, a file picker where there is none),
  shrinks it to at most 1280 px JPEG, and uploads it with
  `usernode.uploadFile(..., { visibility: 'public' })`; only the returned
  URL and file id are stored (`forum_posts.photo_url` / `photo_id`, same on
  `forum_replies`). The image bytes never reach this app's server or
  database, and a text-only post stays the default. A photo the user removes
  or abandons is deleted best-effort with `usernode.deleteFile`.
- `is_demo` rows are staging sample data: they are only returned when
  `USERNODE_ENV=staging` and the page is opened with `?demo=1`. Demo photos
  are a small drawn data-URI placeholder in `server.js` (`DEMO_PHOTO`),
  because platform files are never copied into staging.
- The AI prompt is server-side (`AI_SYSTEM_PROMPT` in `server.js`) and must
  keep telling the model to decline the platform's content-rule topics and
  never to give doses of strong or prescription drugs.
- Text written by people is trimmed and length-checked on the server
  (title 120, body 2000, nickname 40 characters).
