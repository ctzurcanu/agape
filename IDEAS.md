# Agape: uses and future ideas

This is a living collection of product ideas and agreed design decisions, not a list of implemented features. Decisions recorded on 2026-09-13 are identified below; tentative ideas and TBD items remain open. Start small, observe how creators use Agape, and refine the rules with them.

## Core direction

Agape can be a place where creators discover, interpret, curate, and evaluate each other’s work through shared topics. A video is a contribution; a TV is a programmed experience; a subtitle track can be another creator’s interpretation of that experience.

Keep the independent Agape ontology in the shared Supabase project. New votes, rankings, playlists, and relationships belong to `agape`; they must not join or inherit Allways’ ontology.

The existing community rule is a useful foundation: a creator with an approved, verified video in a topic or one of its descendants can comment within that topic subtree. Voting can use the same eligibility principle, with explicit rules for each object being voted on.

## Ways people could use Agape

- **Discover through short programs.** Browse a topic, watch a TV of excerpts, and open full videos that deserve more attention.
- **Creator listening clubs.** A small group watches a weekly program, gives specific feedback, and votes for the next selection.
- **Poetry interpreted through music.** Compare different settings of the same poem, languages, performances, and production choices.
- **AI music showcases.** Organize by genre, language, literary source, mood, or creative technique. Let creators explain their contribution and credit collaborators.
- **Learning channels.** Sequence short explanations into an introduction to a subject, with subtitle links to sources, exercises, and deeper material.
- **Museums and cultural collections.** Build themed programs around an author, region, historical period, or tradition.
- **Festival screenings.** Publish a timed program, invite peer reviews, and select audience and creator awards separately.
- **Work-in-progress sessions.** Share drafts with a private review group before public release.
- **Collaboration discovery.** Find translators, lyricists, musicians, visual artists, researchers, or editors through their contributions.
- **Accessible viewing.** Offer translations, plain-language explanations, and descriptive tracks beside original captions.
- **Editorial channels.** Curators develop a recognizable taste and publish recurring programs that viewers can follow.

## Videos and excerpts

- Give videos separate pages for credits, sources, production notes, versions, and approved topic placements.
- Let a video belong to several relevant topics without duplicating its identity.
- Support several excerpts from one video, each with its own title and topic context.
- Let viewers nominate a particular moment rather than only liking a whole video.
- Distinguish “best excerpt” from “best full video.” Voting after a 45-second preview should not pretend to assess the whole work.
- Add bookmarks, watch-later lists, personal notes, and a way to follow a creator or topic.
- Allow creators to request focused feedback: lyrics, composition, vocals, visuals, clarity, originality, or source accuracy.
- Display alternative versions of a work together, including links to collaborations and responses.
- Recheck availability and gracefully skip removed, private, or non-embeddable videos.

## TVs as first-class creations

A TV should eventually be a named program with its own identity, curator, description, topic placements, cover, revision history, and ordered excerpts. A topic’s automatic feed and a deliberately curated TV are different things.

- **Manual programs:** choose videos, excerpt boundaries, sequence, and subtitle tracks.
- **Automatic programs:** generate a loop from approved topic contributions, recent work, or a published selection rule.
- **Hybrid programs:** fix an editorial core and rotate a discovery slot.
- **Multiple TVs per topic:** introductory, experimental, creator favorites, recent releases, or a particular curator’s selection.
- **Program versions:** publish a stable edition, edit the next privately, and preserve past editions.
- **Scheduling:** premieres, weekly editions, themed days, and festival programs.
- **Shared sessions:** synchronized watching, a host, moderated discussion, and scheduled voting.
- **Forks and collaborations:** let creators propose edits to a program or build a credited derivative.
- **Program navigation:** chapter labels, hover previews, keyboard controls, permalinks to program timestamps, and resume playback.
- **Fair rotation:** cap repeated appearances by one creator and reserve room for new contributors.
- **Curator notes:** explain why excerpts belong together and what to notice.

Keep the TV viewing surface within one screen. Put detailed editing, reviews, and long discussions in optional panels or separate pages.

## Subtitle tracks as creative contributions

Keep YouTube captions available in the dropdown alongside Agape’s alternatives and Off. Agape tracks appear over the video, support timed text, and can contain limited Markdown and web links.

- Name alternatives meaningfully: original lyrics, English translation, commentary, source notes, or a guest creator’s interpretation.
- Support two or three published alternatives initially, with drafts available to editors.
- Give each track its own author credits, language, purpose, and revision history.
- Add direct cue editing, split/merge, “start here” and “end here” buttons, and keyboard shortcuts.
- Pause playback while editing so a transition cannot discard unfinished work.
- Preview a cue at its timestamp and compare two versions without restarting the video.
- Import and export SRT or WebVTT, explaining how formatting and links survive conversion.
- Explore review for proposed translations and corrections; the immediate-publication rule remains open. **Tentative:** use AI to filter injurious language. How flagged text is reviewed, corrected, or appealed is still to be decided.
- Restore earlier revisions and show who changed text, timing, or links.
- Offer viewer preferences for size, background opacity, and placement.
- Make links operable with keyboard and touch; optionally pause playback when opening a source.
- Label lyrics, translations, commentary, and generated drafts accurately. Editorial notes are not a transcript.
- Consider subtitle-track awards or votes separately from the underlying video.

## Inter-creator voting

### Eligibility and context

A proposed starting rule: a verified creator with an approved video in the selected topic subtree can cast a creator vote there. Viewers could have a separate audience reaction; do not combine the two silently.

A vote should record the object, topic context, ballot or season, voter, and eligibility basis. Each creator has one contribution-based voting budget. Connecting several channels must not duplicate that budget; eligible contributions increase it according to the website-wide formula below.

- **Videos:** vote within an approved topic placement. Require a different creator from the video owner and credited collaborators.
- **TVs:** vote within the TV’s approved topic context. Exclude its curator and co-curators from voting for their own program.
- **Creators:** allow peer recognition within a topic, or derive rankings from independently evaluated contributions.
- **Topics:** let active contributors prioritize improvements and recognize community quality. Keep this separate from voting on whether a topic is factually valid.
- **Subtitle tracks:** let qualified peers assess clarity, usefulness, translation, or interpretation.

Decide explicitly whether contributors in sibling subtopics may vote at a shared ancestor. Following the existing subtree rule would allow this at the ancestor, while a narrow subtopic ballot remains limited to that subtopic’s eligible creators.

Keep a vote-time eligibility snapshot. When verification expires, require renewal for new votes; do not silently erase historical ballots. Confirmed fraud can invalidate past votes through an auditable moderation decision.

### Contribution-based voting budget

**Decision — 2026-09-13:** each creator receives a voting budget calculated from their contributions, minus fines:

```text
voting_budget = a * no_videos
              + b * no_subtitles
              + c * no_comments_on_others
              + …
              - z * fines
```

- `no_videos`: the creator’s counted video contributions.
- `no_subtitles`: the creator’s counted subtitle contributions.
- `no_comments_on_others`: comments on other creators’ work.
- `…`: additional contribution categories that may be added later.
- `fines`: penalties deducted through the coefficient `z`.
- `a`, `b`, `c`, …, `z` are floating-point coefficients configured website-wide, rather than separately for each creator or topic.

**Tentative:** the community may set or change these coefficients by vote. The governance procedure is not decided yet.

The budget determines how much voting power a creator can spend; topic eligibility still determines where they can vote. Rules for allocating that budget across objects and ballots remain to be defined.

Open implementation questions include the counting period, renewal and carryover, vote costs, whether subtitles are counted as tracks or individual cues, which contributions qualify, how fines are measured and imposed, and how to handle a negative balance. No coefficient values are chosen yet.

Suggested safeguards: show each creator a breakdown of earned, spent, and deducted budget; keep an auditable ledger; prevent duplicate counting and concurrent overspending; version coefficient changes with an effective date. Contribution spam and repeated trivial edits must not become an easy way to manufacture voting power.

### Ballot formats to explore

- **Useful / recommend:** a simple positive signal for an initial release.
- **Criteria-based ratings:** separate originality, craft, emotional impact, clarity, or educational value. A topic chooses the relevant criteria.
- **Pairwise comparison:** choose between two eligible works after seeing both. Include “cannot judge” and “too different.”
- **Ranked shortlists:** order a limited set of nominees in a festival or weekly selection.
- **Nomination plus review:** creators nominate work; randomly assigned peers produce the shortlist.
- **Contribution-based voting budget:** endorsements consume the creator’s available budget under the formula above; allocation rules remain to be decided.

Start with one format rather than several competing scoring systems. A reasonable first experiment is a topic-scoped recommendation with an optional explanation, no self-voting, and spending constrained by the contribution-based budget. Whether repeated allocations to the same object are allowed remains open.

### Fairness and abuse resistance

- Separate identity verification from judging expertise and editorial quality.
- Prevent duplicate votes, self-votes, and obvious collaborator conflicts in database rules.
- Use rate limits and server-side eligibility checks; a hidden UI button is not enforcement.
- Monitor unusually reciprocal voting, coordinated bursts, and tightly connected voting groups. Treat them as review signals, not automatic proof of abuse.
- Rotate review assignments and limit repeated assignments between the same creators.
- **Decision:** reveal votes only after the ballot closes. Keep votes and running totals hidden from other participants while voting is open.
- Let users skip unfamiliar work without penalty.
- Keep an audit trail for moderators. The exact post-close disclosure format, including whether voter identities are shown, still needs to be specified.
- Allow vote changes until a ballot closes; freeze the result afterward, apart from documented corrections.
- Explain removals and offer appeals. Avoid permanent public labels based on automated suspicion.
- Do not sell votes, ranking weight, or voting eligibility.

## Leaderboards

There should be several leaderboards with clear purposes, rather than a single score claiming to measure all quality.

| Object | Possible boards | Signals to consider | Main distortion to avoid |
| --- | --- | --- | --- |
| Videos | Peer favorites, rising works, new discoveries, craft awards | Eligible peer votes, confidence, age, topic fit | Existing audience size overwhelming quality |
| TVs | Best curation, most useful introduction, discovery programs | Program votes, voluntary saves, explicit feedback, creator diversity | Programs winning just by including famous videos |
| Creators | Peer recognition, helpful reviewers, collaborators, emerging creators | Several evaluated works, useful reviews, credited collaborations | Upload volume or one viral work deciding everything |
| Topics | Active communities, emerging topics, welcoming communities, well-curated maps | Distinct contributors, reviewed placements, useful discussion, coverage | Broad topics always beating narrow ones |

### Ranking choices

- **Decision:** present a topic’s TV results as a **top-10 ranked leaderboard**, rather than a single winner. Show fewer entries when fewer works qualify.
- Offer topic-specific and time-specific boards: weekly, monthly, seasonal, and all-time.
- Show the number of eligible voters and the ranking window next to a score.
- **Decision:** use a configurable participation threshold, initially **3 works**. This counts works, not voters or votes; any additional voter-count threshold remains TBD. Label results below the threshold as provisional.
- Explore confidence-adjusted or Bayesian scores instead of raw averages; publish the method and parameter changes.
- For pairwise ballots, explore a pairwise ranking model with uncertainty rather than counting wins alone.
- **Decision:** the first page includes some randomly selected works to give creators exposure beyond the leaderboard. The number of slots and sampling rules remain open.
- Keep emerging-creator boards and discovery slots so established winners do not occupy every surface.
- Normalize creator rankings across a limited set of works rather than rewarding unlimited uploads.
- Rank a TV edition against the edition people actually watched, not a subsequently rewritten queue.
- Decide when a substantially edited video, program, or track needs a fresh ballot.
- Provide both “top rated” and “new” browsing. Rankings should not become the only route to discovery.
- Do not equate playback events with attention or approval. Any viewing-based signal needs clear limitations and privacy-conscious measurement.

A topic leaderboard should describe activity, curation, or community health. It should not present popularity as evidence that a subject is more important or true.

## Rewards and community roles

- Feature winning works in a clearly labeled weekly TV edition.
- Recognize useful reviewers, translators, curators, and collaborators as well as video authors.
- Use specific badges such as “helpful translation reviewer” with visible criteria and an expiry or season.
- Invite experienced contributors to mentor newcomers or review topic proposals.
- Keep moderation powers separate from popularity scores. Winning a leaderboard should not automatically grant administrative access.
- Let creators opt out of competitive rankings while remaining discoverable.
- Prefer recognition and opportunities to collaborate before introducing prizes or financial incentives.

## Ontology and discovery extensions

- Add facets for language, mood, genre, technique, format, and intended audience without forcing each combination into the parent tree.
- Add relationships such as “interpretation of,” “inspired by,” “translation of,” and “response to,” using Agape-owned records.
- Represent an author, poem, song, or source work separately from its video adaptations when this becomes useful.
- Let communities propose topic splits, merges, and better labels, with moderation and reversible history.
- Preview how a hierarchy change affects eligibility, playlists, and rankings before applying it.
- Preserve historical ballot context when topics move; do not rewrite old competition rules accidentally.
- Show gaps in a collection and invite contributions to underrepresented branches.
- Explain recommendations: shared topic, curator selection, peer endorsement, or new contribution.

## Administration, trust, and operations

- Provide a review inbox for topic placements, subtitle proposals, reported links, vote anomalies, and unavailable media.
- Record moderation actions with reasons and recovery paths.
- Separate private drafts, published editions, and archived editions.
- Add accessibility checks for caption contrast, keyboard navigation, reduced motion, and screen-reader labels.
- Cache public browsing and compute leaderboard snapshots outside interactive requests.
- Publish ranking calculation times and handle delayed recalculation visibly.
- Let users export their authored cues, programs, votes, and reviews where appropriate.
- Keep backend credentials out of the browser and enforce permissions in Supabase.

## Possible data model additions

These are design candidates, not migrations to apply yet:

- `tv_program`, `tv_program_revision`, `tv_program_item`, `tv_program_topic`: named TVs, immutable published editions, ordered fragments, and approved topic placements.
- `subtitle_track`, `subtitle_revision`, `subtitle_cue_revision`: track names, credits, languages, published versions, drafts, and change history.
- `ballot`, `vote`, `vote_criterion`, `vote_eligibility_snapshot`: voting windows, scope, criteria, and auditable eligibility.
- `voting_budget_config`, `voting_budget_ledger`, `fine`: website-wide floating-point coefficients, contribution credits, vote spending, penalties, and effective dates.
- `review_assignment`, `peer_review`, `review_helpfulness`: assigned reviews and feedback on usefulness.
- `leaderboard_snapshot`, `leaderboard_entry`, `ranking_method`: reproducible results tied to a documented method and period.
- `creator_credit`, `collaboration`, `conflict_declaration`: ownership and collaboration context for attribution and voting exclusions.
- `report`, `moderation_action`, `appeal`: accountable community governance.

All ontology references should point into `agape`. Shared authentication identities can reference `auth.users`; Allways’ content and workers remain separate.

## Suggested progression

1. **Finish the viewing and authoring loop.** Reliable playback, three named editable subtitle alternatives, revision history, pause-while-editing, and accessible controls.
2. **Make TVs first-class.** Named programs, stable editions, reorderable fragments, curator credits, and shareable links.
3. **Pilot peer recommendations in one topic.** Clear eligibility, contribution-based budgets, self-vote exclusions, moderation, an explicit pilot period, and votes revealed after close.
4. **Publish video and TV leaderboards.** Show vote counts, uncertainty, time windows, and discovery slots alongside winners.
5. **Add creator recognition and topic health boards.** Reward useful reviewing and collaboration, and keep these distinct from popularity.
6. **Explore events and advanced ballots.** Pairwise comparisons, synchronized screenings, translation awards, and cross-topic showcases after the basic rules work.

## Implementation progress

Started on **2026-09-13**, following the progression above:

- **Subtitle authoring foundation:** pause playback while the TV editor is open; keep unfinished cue drafts on the current device; record text, timing, and deletion history; restore previous revisions, including removed cues; reject stale saves and restores rather than overwrite a newer contribution. Curated tracks remain collaboratively editable; verified video tracks remain creator-only.
- **Named TVs:** several TVs per topic, each with an id, one home topic, an owner, its own excerpt list, subtitle alternatives, and immutable editions published only from a reviewed snapshot. Placement in several topics is not implemented.
- **Review decisions:** reasons required for rejections, one decision per submission, and submission status visible to creators.
- **Voting pilot:** administrator-opened topic ballots for videos or TV editions (never combined), 1 point per recommended work with an optional explanation, starter coefficients a = 3, b = 1 (one subtitle version per TV, track, and day), c = 0.25, z = 1, budgets committed only while a ballot is open, votes sealed until close, and a top-10 board with a provisional label below 3 works.
- **Opening to creators:** public About, Privacy and Terms pages for Google's OAuth verification, shareable topic invitations (`#/join/<topic>`), a studio prompt to add an approved video's moment to its topic TV, and self-serve deletion of Agape data that never deletes the sign-in account shared with Allways.
- **Next:** random discovery slots, time-window leaderboards, and the open questions below (carryover, coefficient governance, voter disclosure).
- AI moderation remains a planned feature.

## Questions to decide through small experiments

Decisions and open questions recorded on **2026-09-13**:

| Question | Current direction |
| --- | --- |
| Are votes public, anonymous to other creators, or revealed only after the ballot closes? | **Decision:** revealed after the ballot closes. The exact disclosure format remains open. |
| What is enough participation before a ranking becomes meaningful? | **Decision:** configurable; start with **3 works**. |
| Which criteria help creators improve rather than simply reward familiarity? | **TBD.** |
| Should a topic pick one TV winner, several editorial selections, or no winner at all? | **Decision:** a leaderboard with **10 ranked entries**, when enough works qualify. |
| How much weight should reviewers, curators, and audiences each have? | **TBD.** |
| How do we credit source authors and collaborators without treating every credit as a verified account? | **TBD.** |
| Which subtitle changes can publish immediately, and which need review? | **Tentative:** AI filtering of injurious language. Publication and review rules are still open. |
| How do new creators receive enough exposure to earn their first independent votes? | **Decision:** the first page selects some works randomly. |
| Which measures indicate a welcoming, productive community without becoming targets for gaming? | **TBD.** |

## Subtitle studio implementation (2026-09-13)

The manual editor now covers TV excerpts and full verified creator videos: side-by-side cue list/video, millisecond timestamps, playback speed, pause while typing, cue looping, a zoomable draggable cue timeline, keyboard edge trimming, split/merge, undo/redo, local draft recovery, Markdown/link preview, search/replace, bulk time shifting, alternative-track copying, and SRT/WebVTT import/export. Publication is atomic and revision-checked, with explicit conflict comparison and recovery through history. A creator can supply a local audio file to render a waveform without uploading it.

YouTube parity is still a target, not a completed claim: automatic speech transcription, transcript-to-audio alignment, automatic translation, and direct retrieval of YouTube caption tracks are not implemented. The embedded player does not expose source audio to the editor; those workflows need a creator-provided media source and a transcription/alignment service. The private Studio reference returned an error during inspection; the manual workflow was cross-checked against https://support.google.com/youtube/answer/2734796.

## Whole-program TV authoring (2026-09-13)

Each named TV has one continuous subtitle workspace spanning every video section. The three alternatives are saved per TV, independent of source-video captions. Subtitles remain attached to source sections when their order changes; cues crossing a boundary are split into section-attached pieces on publication. TV subtitles have conflict detection and recoverable history. A TV's owner or a site administrator can add, remove, and reorder sections from the same studio page.

Video fragments now occupy a blue timeline lane directly above the two subtitle lanes, sharing zoom and the playhead. The owner can drag bodies to reorder, drag edges to trim, or use exact source-time fields. Trims belong to the TV and are validated against the original video duration; source fragments remain unchanged.
