# agape

A community for YouTube creators, with videos organized through an independent
ontology of topics. Built with React, TypeScript, Vite, and Supabase.

See [setup and deployment](docs/SETUP.md) for local development, Google OAuth,
database administration, and GitHub Pages publishing.

## Requirements

- sign-in with a Youtube account
- the site should be hosted on Github pages
- the database should be on Supabase
- share Allways' Supabase project, but keep Agape's ontology independent and non-intersecting

## behavior

- if i am a youtube creator 
- and I have an approved, verified video in a topic or one of its descendants:
  I can comment on other videos in that same topic subtree
- there is also a youtubeTV where fragments of youtube videos run in loop: i have the right to include my video fragment in the correct topic
- the subtitles can contain links and italics and bold (a limited Markdown) as alternative to the subs from youtube

## Stack

- React + TypeScript + Vite frontend, with a GitHub Pages deployment workflow.
- Reuse the existing Supabase project configured in `../allways/.env`.
- Supabase Auth with Google OAuth and YouTube channel verification.
- Supabase Edge Functions for trusted YouTube verification and privileged writes.
- YouTube IFrame Player API for fragment playback; timed Markdown cues displayed beneath the player.

## Independent ontology in the shared database

Reuse Allways' ontology design, not its ontology records. Both applications use
the same Supabase project, but Agape owns a dedicated Postgres schema, `agape`.
Allways' existing ontology remains in `public`. The reference implementation is
in `../allways/supabase/migrations/` and `../allways/internal/menu/`.

- `agape.ontology_node`: independent UUIDs, slugs, publication status, ordering,
  and parent pointers. Unlike Allways, the canonical hierarchy lives only in
  `parent_id`, avoiding duplicate parent state. Cycles are rejected.
- `agape.ontology_edge` and `agape.edge_type`: typed `related` and `see_also`
  cross-links. Each topic has at most one canonical parent; roots have none.
- `agape.node_name` and `agape.locale`: translated names/descriptions with source-language
  fallback. Use stable IDs for associations, not translated labels.
- `agape.tag_kind`, `agape.tag`, `agape.tag_name`, `agape.node_tag`, and
  `agape.node_tag_effective`: independent facets,
  translated tags, and tags inherited from ancestor nodes.

### Isolation rules

- Every ontology foreign key, including parents, edges, translations, tags, and
  video/fragment topic assignments, references tables inside `agape` only.
- Agape has its own roots, UUID identities, edge types, locales, tags, proposals,
  and translation jobs. Do not import Allways' medical topics or records.
- Identical names or numeric IDs in the two schemas do not identify the same
  topic. There are no cross-ontology edges, mapping tables, unions, or fallback
  searches into Allways.
- Qualify tables and functions with `agape.` in migrations and SQL; scope all
  Supabase data/RPC calls to the `agape` schema. A missing Agape table or empty
  ontology is an explicit setup/empty state, never a fallback to `public`.
- Agape has its own RLS policies, functions, triggers, and job tables. Allways'
  existing workers do not consume Agape's proposals or translation jobs.
- Shared Supabase Auth identities may be referenced through `auth.users`, but
  creator verification, membership, and permissions belong to Agape.

This separates the ontology data and application behavior. It is not a security
boundary against the shared project's administrative keys, which remain trusted
across the database. Allways' public content may still be readable via its own
API; Agape navigation must never query or combine it.

The React navigation offers roots, ordered children, breadcrumbs, related topics,
localized search, and inherited tag filters. Related-topic links are distinct
from the canonical parent breadcrumb trail. Agape’s initial authored hierarchy starts at Videos → Music → AI Music, with
playlist-inspired branches for poetry, traditions, sacred music, and war and peace. Browse/search returns up to 100
topics and the latest 100 matching videos per query; narrow the topic or filters
to explore larger collections. TV loops approved creator fragments plus curated public excerpts. The first
curated loop contains seven 45-second excerpts from the Mihai Eminescu playlist.
Curated entries do not confer creator ownership or commenting eligibility.

### Implemented video community

Keep application tables in the same dedicated `agape` schema:

- `agape.channels`, `agape.videos`: verified creator ownership and YouTube metadata.
- `agape.video_topics(video_id, node_id)`: many-to-many links to Agape ontology nodes.
- `agape.fragments`: a video reference and start/end timestamps.
- `agape.fragment_topics(fragment_id, node_id)`: independent topic placement for clips.
- `agape.comments`, `agape.subtitle_cues`: community discussion and timed limited Markdown.

Video and fragment topic links reference `agape.ontology_node.node_id`; videos need
not become ontology nodes. Their lifecycle and permissions remain separate.
Use restrictive foreign-key deletion behavior for topic references so
ontology deletion requires an explicit reassignment decision.

Browsing a topic can show direct videos or include descendants. YouTube category
metadata stays separate from ontology topics. Comments belong to the selected
topic context: both the target video and a creator's own verified video must
have approved placements within that subtree. For example, a Biology creator can
comment on a Physics video in their common Science topic, but not within the
Physics-only context. Verification expires after 30 days. Postgres enforces
eligibility and identity on every comment insert.

The creator studio submits videos through YouTube channel verification, requests
topic approval, publishes timed fragments in approved topics, and manages timed
Markdown subtitle cues. An administrator reviews topic suggestions and video
placements. Unapproved topic assignments cannot grant comment rights. The studio
shows each placement and topic suggestion as waiting, approved, or not approved,
with its date and the reviewer's reason; rejections require a reason, and each
submission can be decided only once until it is resubmitted.

### Configuration and integration status

- `.env.local` contains only the shared project's browser URL and publishable key,
  renamed to `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `.env.server.local` holds copied Supabase backend/database credentials for local
  backend or migration tooling. Load it explicitly only in that tooling; never
  expose these values through Vite configuration or client code.
- Both local configuration files are ignored by Git. `.env.example` contains
  placeholders only. GitHub Actions will need the two browser configuration values.
- The frontend explicitly selects `agape` and uses `agape.auth` browser storage.
  The schema is created and exposed in the shared project's Data API. Public
  navigation has been verified using the copied browser key.
- Allways' tables and policies stay unchanged. Agape has independent RLS policies,
  invoker-rights navigation RPCs, and controlled write functions. All its ontology
  foreign keys stay within `agape`; only user identities reference `auth.users`.
- Migrations are in `supabase/migrations`, with a transaction/checksum runner at
  `scripts/database.mjs`. Do not replay Allways' migrations or seeds.
- `npm run build`, frontend tests, local PostgreSQL isolation/authorization tests,
  and the verification function's Deno type check are available. See the setup guide.
- The `agape-verify-video` Edge Function is deployed to the shared Supabase project.
- Google OAuth is enabled using the local client credentials. Agape's local
  redirects are allowed, and the Google authorization URL has been verified with
  PKCE and YouTube read access. The first successful user sign-in has confirmed
  consent and token exchange.
- GitHub Pages is deployed. Site moderation still needs an explicitly designated
  administrator; TV creators administer their own programs independently.
- The initial 18 topics were authored from Christian Tzurcanu’s playlists; no
  creator videos have been imported. Seven curated TV excerpts are stored
  separately in `agape.curated_tv_fragment`. The source links and hierarchy are stored in
  `data/initial-ontology.json`; `npm run db:seed-topics` adds missing seed topics
  without overwriting existing ones. English
  and French locales are configured; missing French labels fall back to English.
  Translation jobs are queued independently, but no automatic translator is running.

### TV ownership, saving, and editions

A topic's TV page (`#/tv/<topic>`) plays the automatic, read-only loop of its approved
excerpts and lists the named TVs whose home is that topic. A topic can have any number of
named TVs. Each one (`agape.tv_program`) has its own id and link (`#/tv/program/<id>`),
one home topic, an owner, and its own excerpt list (`agape.tv_program_item`) with its own
order, trims, subtitle alternatives, history, and editions.

**Create a TV** is available to site administrators anywhere and to creators with a
currently verified, approved video in the topic's subtree; the root TV is
administrator-only. A new TV starts from the topic's current loop. Its owner, or a site
administrator, can remove, add, reorder, and trim sections. Every section must come from
the TV's home topic or its descendants, within the original video's duration.
Sequence edits save atomically and retain a browser draft until acknowledged.
On reopening the editor, a matching previous draft offers **Publish video changes**;
this also recognizes the older array-format drafts. Stale saves are rejected.
Drafts are scoped to the browser origin: localhost and GitHub Pages have separate storage.

**Save TV** updates the current program. **Review stable edition** lists exactly what will
be frozen: its name, ordered source ranges, and all available subtitle alternatives and
languages. **Publish this edition** is rejected if anything changed after that review.
Each edition has a permanent `?edition=<UUID>` link and is selectable in the player.
Frozen editions cannot be edited; return to **Current TV** to make further changes.
YouTube-hosted video availability and YouTube's own captions remain externally controlled.

Edition links from before named TVs had ids (`#/tv/<topic>?edition=<UUID>`) redirect to
their TV. Placing one TV in several topics is not implemented.

### Voting pilot

Administrators open a ballot for one topic from **Review**: either videos with an approved
placement in the topic's subtree, or the latest published edition of each named TV whose
home is in that subtree. Works are fixed when the ballot opens, and video and TV ballots are
never combined. A ballot needs at least two works; results with fewer than three are
provisional.

Creators with a video verified in the last 30 days and approved in the ballot's topic subtree
can recommend works (`#/ballot/<id>`), except their own video or TV. Each recommendation costs
one point, with an optional explanation, and can be changed or withdrawn until the ballot
closes. Votes and totals stay sealed, including from administrators, until closing; results
then show a top-10 board with points, voters, and unnamed explanations. Administrators can
audit named votes only after closing.

Each creator's budget is `3 × videos with an approved placement + 1 × TV subtitle versions (one
per TV, track, and day) + 0.25 × comments on others' videos − 1 × fines`, from
`agape.voting_budget_config`. Points count only while their ballot is open. Fines carry a
reason the creator sees in the studio. Discovery slots, pairwise ballots, and coefficient
governance are not implemented.

### Public pages, invitations, and data deletion

Static pages in `public/` are served without JavaScript at `about.html`, `privacy.html`, and
`terms.html` under the site base, and the app footer links to them. They are the homepage,
privacy policy, and terms URLs for Google's OAuth consent screen, and are drafts for the operator
to review.

`#/join/<topic>` is a shareable invitation to a topic. It explains how to join, keeps the topic
through Google sign-in, and continues to the creator studio with that topic selected. The link
grants nothing by itself: participation still requires a verified video and an approved
placement. Topic pages offer **Invite a creator** to copy it. After approval, the studio prompts
creators to add a moment of the video to the topic's TV.

**Delete my Agape data** in the studio calls `agape.delete_my_agape_data`, which removes the
person's channels and videos (with everything attached), comments, topic suggestions, named TVs
and editions, ballot votes, fines, and administrator role, and removes their name from shared
subtitles, editions, review decisions, and ballots. It never deletes the Supabase sign-in
account, and refuses to remove the only administrator.

### Notices, discovery, and creator profiles

Review decisions (with reasons), ballots opening in a creator's eligible topics, closed-ballot
results, and fines create in-app notices (`#/notifications`, with an unread count in the header).
Email is opt-in per kind. The `agape-send-notifications` Edge Function, called every 15 minutes by
the `Send Agape notices` workflow, queues closed-ballot notices and emails opted-in notices through
Resend; every email carries a link to `unsubscribe.html` and a one-click `List-Unsubscribe` header
handled by `agape-unsubscribe`. Without email configuration, notices stay in the app.

Topic and home pages show three random approved videos under **Discover**, at most one per creator,
preferring videos that have not been recommended on a closed ballot.

`#/creator/<user>` is a public creator profile (verified channel titles, approved videos and topics,
named TVs, and closed-ballot ranks). It exists only while the creator has an approved placement and
never shows email or sign-in data. The Watch page links a video's channel to its creator.
