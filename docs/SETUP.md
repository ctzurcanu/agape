# Running and deploying Agape

## Local frontend

Use Node 22.12+ (Node 22 is selected by `.nvmrc`).

```sh
nvm use
npm ci
npm run dev
```

The app runs at `http://127.0.0.1:5173`. Browser configuration is already copied
from the actual `../allways/.env` into the ignored `.env.local`. Backend database
credentials are in the separate ignored `.env.server.local`; both files have
owner-only filesystem permissions. Never put server credentials in `VITE_*`.

## Shared database, separate ontology

Agape's migrations create only the `agape` schema. Its tables, topic identities,
relationships, translations, tags, and video classifications are independent of
Allways' `public` ontology. A shared `auth.users` identity does not grant Agape
administrator or creator permissions.

```sh
npm run db:check
npm run db:migrate
npm run db:expose
npm run api:check
```

The migration runner understands both PostgreSQL URIs and Allways' libpq
`host=... dbname=...` configuration. It uses transactions, an advisory lock,
and an Agape-owned checksum ledger. Do not edit applied migrations; add another
file. It refuses to adopt an existing unmanaged `agape` schema.

`db:expose` preserves the existing exposed-schema list, adds `agape`, and reloads
PostgREST through a database role setting. If your project does not allow this,
add `agape` in Supabase's Data API settings, keeping the existing entries.
If you later edit the dashboard's exposed-schema setting, keep Agape included
and reconcile the `authenticator` role's `pgrst.db_schemas` override.

There is no automatic seed of Allways topics. Run `npm run db:seed-topics` to
add the independent Videos → Music → AI Music hierarchy authored from the
channel playlists in `data/initial-ontology.json`. This preserves existing topics
and imports no videos.

## Enable Google and YouTube

Google is now enabled in Supabase, and both local Agape redirects are configured.
Existing Allways redirects and the shared project's Site URL were preserved.
The authorization redirect has been checked; complete an actual Google sign-in
in Agape to verify the consent screen and token exchange.

This requires access to the project's Google Cloud OAuth application:

If the OAuth client still needs to be created, open Google Cloud Console →
Google Auth Platform → Clients and choose a **Web application** client. For
assisted Supabase configuration, save its credentials to ignored
`.env.google.local` with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` entries.
Do not add a `VITE_` prefix or commit this file.

1. Enable YouTube Data API v3 in Google Cloud.
2. Create/configure a Web application OAuth client. Set its authorized callback
   to `https://yajenrxydqzljmbaoeyl.supabase.co/auth/v1/callback`.
3. Enable the Google provider in the shared Supabase Authentication settings,
   supplying that client ID and secret. Preserve any existing providers.
4. Add `http://127.0.0.1:5173/` and the eventual GitHub Pages URL to Supabase's
   allowed redirect URLs, preserving Allways' existing URLs and site settings.
5. Configure the Google consent screen and the read-only YouTube scope
   `https://www.googleapis.com/auth/youtube.readonly`. While the OAuth app is in
   testing, add the intended Google accounts as test users. Public release may
   require Google's OAuth verification.
6. For verification, set the consent screen's application homepage to
   `https://ctzurcanu.github.io/agape/about.html`, its privacy policy to
   `https://ctzurcanu.github.io/agape/privacy.html`, and its terms of service to
   `https://ctzurcanu.github.io/agape/terms.html`. Google requires the authorized
   domain (`ctzurcanu.github.io`) to be verified in Google Search Console, which
   may need the user-site repository or a custom domain. Review the policy texts
   before submitting, and keep them in sync with what the code stores.

Sign-in uses PKCE and Agape-specific browser auth storage. Google credentials
are sent only to Supabase's provider configuration, never shipped in the app.
The Google access token is used transiently for channel verification; no Google
refresh-token store or background access is implemented. Reconnect Google when
the provider token expires or is unavailable.

## Notices and email

In-app notices need no setup. Email delivery is optional:

1. Create a Resend account and verify a sending domain you own (a `github.io`
   address cannot send email).
2. Set the function secrets. They are prefixed with `AGAPE_` because function
   secrets apply to the whole Supabase project:

   ```sh
   supabase secrets set --project-ref yajenrxydqzljmbaoeyl \
     AGAPE_RESEND_API_KEY=... AGAPE_EMAIL_FROM='Agape <notices@your-domain>' \
     AGAPE_SITE_URL=https://ctzurcanu.github.io/agape/ AGAPE_CRON_SECRET=...
   ```

   Use a long random value for `AGAPE_CRON_SECRET`.
3. Deploy both functions by name:

   ```sh
   supabase functions deploy agape-send-notifications --project-ref yajenrxydqzljmbaoeyl --use-api
   supabase functions deploy agape-unsubscribe --project-ref yajenrxydqzljmbaoeyl --use-api
   ```

4. Add the same `AGAPE_CRON_SECRET` as a GitHub Actions repository secret. The
   **Send Agape notices** workflow calls delivery every 15 minutes (and can be run
   manually). Until email is configured it reports that and exits successfully;
   closed-ballot notices are still created.

## Deploy verification

The function has been deployed to the shared project. To deploy future updates:

```sh
supabase login
supabase functions deploy agape-verify-video --project-ref yajenrxydqzljmbaoeyl --use-api
npm run api:check
```

Deploy this function by name so unrelated Allways functions are not affected.
The Supabase runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
The handler validates every user JWT with `auth.getUser`, checks that the Google
token belongs to that user's linked Google identity, verifies the video against
the authorized channel, and performs an atomic service-only import. The gateway
JWT check is disabled specifically for this function because authentication is
performed in its handler, including support for asymmetric project signing keys.
The endpoint allows ten verification attempts per user per hour.

Only public, embeddable, non-live videos with a known duration are accepted.
Topic placement starts pending and needs administrator approval. Reverification
preserves approved placement. A verified video grants commenting eligibility for
30 days; resubmit it to refresh verification. Playback availability can change on
YouTube afterward, so the player provides an error and skip/open controls.

## First administrator and topics

Sign in to Agape once, then use the database-owner tooling:

```sh
npm run db:admin -- your-google-email
```

Refresh the app. Administrators can create root topics or children directly,
and review suggested topics and video placements in **Review**, whose navigation
link shows the number waiting. Rejecting requires a reason; approving accepts an
optional note. Each decision is recorded once in `agape.moderation_decision`; an
item that is no longer pending cannot be decided again. Submitters see the
decision, date, and reason in the creator studio, but not which administrator
decided. Resubmitting a rejected video returns it to the queue. Other signed-in
users can suggest topics. Creating topics queues independent translation jobs;
until translations are supplied, French navigation falls back to English.
There is no automated translator running. Add reviewed translations to
`agape.node_name` and mark their `agape.translation_job` rows done with trusted
database tooling. Additional relationships and facet assignments can likewise
be maintained in `agape.ontology_edge`, `agape.node_tag`, and the tag tables.

## GitHub Pages

The workflow is included at `.github/workflows/pages.yml`. This workspace does
not yet have a Git repository or remote, so no public site has been published.

1. Push the project to the intended GitHub repository.
2. Select GitHub Actions as its Pages source.
3. Add repository Actions variables `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.local`. These are browser settings;
   do not add any database password or service key to the frontend workflow.
4. Push to `main` or run the workflow manually.
5. Add the resulting Pages URL to the Supabase OAuth redirect allowlist.

The workflow derives the asset base path from Pages settings. Routes use the
URL hash, so refresh and shared links work under repository subpaths.

## Verification

```sh
npm run build
npm test
npm run test:edge
deno check --config supabase/functions/agape-verify-video/deno.json supabase/functions/agape-verify-video/index.ts
```

The build scans emitted frontend files for backend credentials. Frontend tests
cover YouTube URL validation, restricted Markdown links, subtitle cue timing,
and time formatting. Seven Deno handler tests use mocked Google/Supabase
responses to verify token identity binding, ownership, public-video eligibility,
rate limits, rejection of invalid sessions, and trusted import metadata. These
do not replace a real Google OAuth end-to-end check once credentials exist.

For meaningful database checks, use an isolated local PostgreSQL database named
`agape_test` (the runner refuses remote test URLs):

```sh
TEST_DATABASE_URL=postgresql://localhost:5432/agape_test npm run db:test
```

The database tests use a minimal local Supabase Auth fixture. They verify
independent ontology IDs, no foreign keys to Allways, unchanged Allways records,
localized navigation, inherited tags, cycle rejection, subtree commenting,
expired and unapproved verification, ownership, moderation boundaries, timing,
atomic imports, and verification rate limits. Test content is rolled back.

## Curated Agape TV

After migrations and the initial topic seed, run `node scripts/database.mjs seed-tv`
to add the Mihai Eminescu topic and seven public playlist excerpts from
`data/eminescu-tv.sql`. Reruns preserve existing entries. Each excerpt runs from
0:30 to 1:15; the ordered loop lasts 5:15. These are opening excerpts, not
manually selected musical highlights.

Curated embeds are stored separately from verified creator videos, confer no
commenting rights, and link to the full video on YouTube. Browser roles have
read access only; trusted database tooling manages curated entries.
`node scripts/check-tv.mjs` verifies the public queue and ancestor topic filters.

TV includes a keyboard-accessible whole-program seek slider beneath the player,
with clickable markers at video transitions and a fixed-width timer. Seeking
across excerpts selects the matching video and original-video timestamp. Open
**Add subtitles & links** to author timed subtitles in the selected language.
Signed-in viewers can contribute to curated excerpts and remove their own cues;
verified creator videos retain owner-only editing. Cue times use original-video
seconds and are constrained to the current excerpt. Supported markup is
`**bold**`, `*italic*`, and `[label](https://example.com)`; HTML and images are disabled.

The light palette is preserved. Dark appearance follows the operating system
through `prefers-color-scheme`, including changes while the page is open.

`node scripts/database.mjs test-tv-subtitles` checks timing and author permissions
in a transaction that rolls back its test records.

TV uses a viewport-height layout with compact channel heading and fixed controls.
The optional subtitle editor opens as an overlay; on narrow screens the queue
is available through the video selector.

`node scripts/database.mjs seed-subtitles` publishes the original English
**Agape notes** track for all seven Eminescu excerpts (21 timed cues). These are
contextual notes with links, not lyrics or a translation. Select **Agape notes**,
**Community**, or **Off** under the player. Community contributions remain
authored in the selected interface language.

### Editable subtitle alternatives

TV now suppresses YouTube caption modules and uses three Agape subtitle versions
per excerpt and language, selected from the dropdown. Version 1 preserves the
previous notes; versions 2 and 3 initially have no cues. Each version supports
timed Markdown text and web links. Choose a version, open **Edit subtitles**,
then use **Edit subtitle** / **Save changes** to modify existing text or timing,
or **Add subtitle** to add a cue. Curated tracks are shared and editable by
signed-in contributors; verified creator videos retain owner-only editing.
This supersedes the earlier notes/community distinction and author-only deletion
for curated tracks. The last editor and update timestamp are recorded.

The subtitle dropdown includes **YouTube**, three editable Agape versions, and
**Off**. Selecting YouTube restores native CC; selecting an Agape version hides
native CC and renders timed white text on translucent black backgrounds over
the bottom of the video. Links remain clickable. Track switching preserves
playback position. TV's fullscreen control includes the subtitle overlay.
