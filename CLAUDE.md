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
One screen with four tabs: a searched and filtered FAQ of 15 common
questions, a personal Ternakku record book for the farmer's own animals, a
shared forum where farmers post questions and replies under a nickname typed
each time, and a short AI chat (Tanya AI). Answers stay general and point to
a vet or the dinas peternakan for serious, emergency or contagious cases.
Farmers often read on a weak-signal phone: keep the page light, the text
large and the buttons big.

The Ternakku tab keeps one record per animal: name or ear tag, kind, age,
photo, weighings from chest-circumference estimates, and notes for daily
life, sickness and treatment. It turns the care dates into four reminders
(vaccine, deworming, expected birth, weighing), draws the weight trend,
shares a plain-text summary to a vet over WhatsApp, and fills the Tanya AI
box with the selected animal's data. A record belongs to the Homeroom
account that made it and is never shown to anyone else.

## Your people's data

`usernode-user-data.js` erases a person's rows when they delete their
Homeroom account, and exports them when they ask for a copy. By default it
covers every table with a `user_id` (or `usernode_pubkey`) column. When
you add a table that keys a person's rows another way (`author_id`), add it
to `OWNED_BY`; when a table's `user_id` is not the person the row is
about, add it to `SKIP`. Keep the file and its mount in `server.js`.
`animals`, `animal_weights` and `animal_notes` all carry `user_id`, so the
default covers them (the weights and notes cascade from `animals`).

## Design

This app's look. The first real version fills in the blanks; every later
change follows it, and updates it when a request changes the look on purpose.

- **Palette:** accent: sage green (`accent`, with `accent-soft` behind
  accent text for the active chip and tab pill); neutrals: warm cream and
  green-black (the dark look's ground); animal markers: soft brownish cream
  (goats and sheep, `straw` / `straw-bg`), earth brown (cattle, `earth` /
  `earth-bg`), and green on the raised ground for chickens and the barn for
  Umum. No loud yellow. The firmer disease/medicine note uses `warn-bg` with
  a `danger` edge. Light and dark values are the tokens in
  `styles/tailwind-input.css`; the dark look keeps each hue.
- **Signature element:** a round marker on every FAQ question and forum post
  holding a line drawing of the animal's head (cow, goat, hen) or a small
  barn for Umum. The animal filter is one sideways-scrolling row of the same
  drawings in round buttons, with the full name underneath on one line (the
  kambing chip reads "Kambing/Domba"; cards and tips keep "Kambing & Domba")
  and a slim green position bar; the same row appears on the forum.
- **Type scale:** screen titles are `text-heading` (20/28), `text-body`
  (18/26), `text-small` (16/22), captions 14 px at the smallest. Body text is
  18 px on purpose.
- **Photos:** a chosen photo is a 72 px square preview (12 px corners, line
  border); in a post it fills the column (max 360 px tall), in a reply it is
  the same narrower (240 px), and in a chat bubble it sits at the top of the
  bubble (max 240 px wide). No new colours.
- **Layout:** each tab's header has a small title (the FAQ one with a
  time-of-day greeting) and an ⓘ button that opens the safety note
  ("Informasi umum, bukan pengganti dokter hewan. ..."). The tab's content
  scrolls above a fixed 64 px tab bar with no banner; the active tab sits in
  a soft green pill and Tanya AI's icon is always accent. Safety text also
  sits under every FAQ answer (a red-edged note on disease/medicine topics)
  and as one plain line in Tanya AI. FAQ questions are separate cards with
  the animal name, a helped count and, where flagged, a green "Terjawab
  dokter hewan" badge. Alat cepat is three uniform cards (green icon on top,
  one-line title, short description) with calendar, syringe and scale line
  icons; a soft-green "Tips hari ini" card sits between the tools and the
  questions, with a 44 px × button that hides it until the page is reloaded.
  Sections are 24 px apart and cards
  16 px apart. A tab change fades the new view up over about 220 ms, and the
  tab pill crossfades. Buttons and fields are at least 48 px tall. The tab
  bar and the page's bottom padding use the safe-area inset the Homeroom
  bridge publishes (`var(--un-safe-inset-bottom, env(safe-area-inset-bottom,
  0px))`), so they clear a phone's system navigation bar.

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

- **Ternakku records are private.** `animals`, `animal_weights` and
  `animal_notes` are marked `staging:private`, are keyed by `user_id`, and
  every route reads them by the signed-in account. Do not seed demo rows for
  the viewer: a farmer's animals are personal, so the Ternakku tab starts
  with its empty state and a tester adds their own. There is no `?demo=1`
  sample animal.
- **Reminders are estimates, not a schedule of record.** The four due dates
  are computed in the page from the animal's care dates and the same general
  timing as "Alat cepat": vaccine every 6 months (chickens every 4),
  deworming every 4 months, and weighing every 30 days. The copy always tells
  the farmer to follow the vet or dinas peternakan, and no drug name or dose
  is ever shown.
- **The app reasons in Asia/Jakarta (WIB).** "Today" for a reminder, and the
  default date of a weighing or note, is the Jakarta day both in the page
  (`todayIso()`) and on the server (`todayJakarta(req.now)`), so a preview's
  `?un-now=` moment and the real clock agree.
- **Weight estimates use the quick tool's own formulas**: Schoorl for cattle
  ((lingkar dada + 22)² / 100) and Lambourne for goats and sheep
  (lingkar dada² × panjang badan / 10840). The server computes them, so the
  chart only holds numbers the formula produced; a chicken's weight is typed
  from a scale.
- A Ternakku share sends text only, never the page URL, which carries the
  viewer's token.

- The 15 FAQ answers live in `public/index.html` as the `FAQ` array: they
  are app content, not stored rows. `warn: true` marks disease/medicine
  topics, which get the firmer note. `helps` and `vet` are editorial
  metadata for the card count and the "Terjawab dokter hewan" badge, not
  analytics. `TIPS` holds one short tip per animal for "Tips hari ini";
  with "Semua" selected it rotates by the local date. The tip card can be
  closed with its × button; that lasts until the page is reloaded (memory
  only, no storage), and searching or changing the animal does not reopen it.
- The quick tools (Alat cepat) compute on the phone only. The vaccine and
  deworming schedule (`SCHEDULE`) gives timing only, never a drug name or
  dose. Sharing a FAQ shares text only, never the page URL (it carries the
  viewer's token).
- The forum is one shared board. Posts carry a nickname typed each time;
  Homeroom's account (`user_id`) decides who may remove a post or reply.
  `forum_reports` only records reports; nothing is hidden automatically.
- `is_demo` rows are staging sample data: they are only returned when
  `USERNODE_ENV=staging` and the page is opened with `?demo=1`.
- Forum questions and replies, and a Tanya AI question, may carry **one**
  optional photo. The browser shrinks it and uploads it with
  `usernode.uploadFile`; rows store only `photo_url` and `photo_id` (never
  image bytes), and the server accepts a URL only on the platform's own
  `/app-files/<32-hex id>` path. Demos seed a data URI, which the server
  rejects from clients. Photo upload needs the Homeroom shell; outside it the
  control is replaced by a short note.
- The AI prompt is server-side (`AI_SYSTEM_PROMPT` in `server.js`) and must
  keep telling the model to decline the platform's content-rule topics and
  never to give doses of strong or prescription drugs.
- Text written by people is trimmed and length-checked on the server
  (title 120, body 2000, nickname 40 characters).
