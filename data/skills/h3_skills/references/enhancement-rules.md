# H3 JSON Director Enhancement Rules

## Contents

1. Boundaries
2. Responsibility decomposition
3. Material planning
4. Temporal feasibility
5. Filmable direction
6. Shot differentiation and endings
7. Camera, editing, and exact content
8. Long-video continuity
9. Current operating limits

## 1. Boundaries

Use these rules to improve planning and execution. The official Base and Ref2VA guides remain authoritative for H3 semantics. The machine-readable `h3-director-json-v1.schema.json` remains authoritative for output structure.

Do not import a fixed story template, cut rhythm, BPM, shot count, hook, climax, final-two-second buffer, Seedance `@` syntax, or generic negative-prompt list. Treat examples as syntax evidence only; never inherit their subject, setting, action, style, duration, camera, dialogue, audio, or exclusions.

Use positive direction first. Define the intended subject, world, object count, action, and result, then leave all unclaimed choices open. Add an exclusion only when a real prohibition or costly recurring failure cannot be resolved by stating the desired visible state.

Keep requirement ledgers, risk analysis, reasoning, and validation notes internal. The final JSON describes what H3 should create, not how the agent reasoned.

## 2. Responsibility decomposition

Separate **content identity** from **source arrangement** before creating references. For every important fact, decide whether the user wants it anchored, preserved, guided, or free. Apply this independently to identity, environment, composition, motion, appearance, and audio.

A polished source asset often contains many correlated signals at once. The model may treat repeated strong references to the same asset as a request to reproduce its whole solution. Prevent this by assigning only the responsibilities that matter. Strong identity preservation does not require source pose preservation. Environment preservation does not require source framing preservation. Style guidance does not require source typography or layout preservation unless explicitly requested.

Use the smallest sufficient lock set:

- **identity lock**: preserve the reusable subject, product, object, wardrobe, or other visible identity;
- **world lock**: preserve the semantic setting and required stable environmental facts while allowing new blocking and camera positions inside it;
- **composition lock**: preserve framing, layout, pose, or spatial arrangement only when explicitly needed;
- **motion lock**: preserve or transfer action, camera, editing, rhythm, or temporal behavior only when it is a real requirement;
- **appearance guidance**: describe visual language in `direction.visual_style` when text is sufficient; create a source-backed `style_reference` only when the asset itself must guide the look.

When continuity and novelty conflict, preserve invariants and vary the unlocked axes. Do not solve repetition by releasing a world that the user wants preserved, and do not solve continuity by returning every shot to the same composition.

## 3. Material planning

Inspect each available asset and assign one primary responsibility:

- image: concrete frame, identity, product geometry, object, scene, wardrobe, style, pose, or storyboard;
- video: editing source, continuation source, action, camera, cuts, rhythm, or visible subject source;
- audio: reused signal, voice, dialogue or lyric content, music style, beat, ambience, sound texture, or continuity.

Resolve competing sources before writing. Let one source decide identity while another may guide motion or style without replacing identity. Use only observed facts and explicit user statements. Do not infer hidden mechanisms, controls, articulation, material composition, or product functions.

For complex tasks, internally track:

- content that must appear;
- observable facts that must remain stable;
- allowed changes;
- explicit exclusions;
- which asset decides each fact.

Resolve conflicts using the authority order in `SKILL.md`. Do not remove an explicit requirement merely to make generation easier.

## 4. Temporal feasibility

Judge whether actions, cuts, state changes, dialogue, transitions, inserts, composite beats, and synchronized events fit the target duration. Do not average shot lengths or enforce a narrative formula. A fast sequence may intentionally mix longer action passages with very short editorial accents; equal shot duration is not a default target.

When overloaded:

1. preserve the central result and explicit must-have events;
2. compress setup into an opening state;
3. combine compatible movements into one causal action;
4. remove only redundant cuts;
5. split one requested video into multiple H3 clips only when its total duration exceeds 15 seconds.

Treat deliberate fast montage as valid when each short shot communicates a distinct readable event, detail, viewpoint, product feature, reaction, or rhythmic function. A brief editorial insert does not need a full action arc when its purpose is clear. Warn when density is likely to reduce legibility, but do not fail validation only because the shot count is high.

For any requested total duration from 4 through 15 seconds, preserve one generation clip. Keep cuts, inserts, transitions, and beat changes as internal `storyboard` shots. Never convert a 10-second request into `5 + 5`, an 8-second request into `4 + 4`, or a 15-second request into multiple clips merely to reduce creative density.

## 5. Filmable direction

Express the central intention through a small amount of observable evidence. Choose the cue that carries the scene—such as a gaze change, decisive displacement, product result, contact event, or sound accent—rather than enumerating every possible facial, bodily, environmental, and camera response.

State physical causality positively at the level needed for the requested result. Keep required hands, props, contact, object count, and direction coherent, but let H3 supply ordinary intermediate motion, reflections, secondary particles, and micro-reactions unless one is essential.

Use `direction.continuity` for one concise positive statement of the most important invariants. Put the dominant state change in the relevant shot's `action`; do not duplicate it across direction, references, shot prose, and exclusions.

## 6. Shot differentiation and endings

Let shot boundaries express the requested sequence without turning them into a frame-by-frame contract. A continuity shot usually carries one dominant action or state change. A brief insert may carry one readable detail, texture, reaction, product feature, or rhythmic accent.

Review adjacent shots for four practical failures: contradictory start/end states, unexplained object-count changes, accidental screen-direction reversal, and an unintended restart of the preceding action. Do not require every shot to differ across framing, angle, movement, blocking, spatial zone, and function. Repeated scales and return angles are valid when they support continuity, rhythm, emphasis, or a deliberate callback.

For dynamic work, decide whether the requested energy comes mainly from physical displacement or from editing. Strengthen the dominant one and keep the other simple. Select only the editing devices that materially help the idea; do not automatically combine split screens, speed ramps, transitions, inserts, camera sweeps, and beat cuts.

Constrain the ending only to the degree the user needs. An endpoint frame, handoff, product lockup, text card, loop, or explicit final gesture should be concrete. Otherwise describe the intended resolution or atmosphere and allow H3 to compose the terminal image.

## 7. Camera, editing, and exact content

Give each shot one dominant camera relationship when the camera matters: fixed observation, following, leading, crossing, revealing, or another simple readable behavior. Add framing, angle, amplitude, speed, lens, or transition detail only when it changes the result. Do not stack camera vocabulary merely to make the prose sound cinematic.

Describe shot-to-shot transition logic only when the transition carries a required action, geometry, identity, dialogue, sound, or explicit visual effect across the cut. Otherwise let a plain cut and the surrounding shot states imply the connection.

For rhythm-driven work, plan a simple density curve rather than a sequence of equal boxes. Identify only the major visual accents that need explicit timing and let H3 shape the smaller connective beats. Use `audio.sync_basis` when a planned beat or real audio reference exists; do not claim frame-accurate source synchronization without `<Audio N>`.

Use split screen, multi-panel compositions, or montage when the user requests them or when one clearly solves an information-layout problem. Treat panels as editorial composite space and give each a readable purpose, but do not add a composite effect as a generic shortcut to faster pacing.

For source-video editing, internally create a minimum-difference delta:

- keep untouched subjects, action, camera, timing, sound, and environment;
- modify only the requested elements;
- remove the target and its reflections, shadows, sounds, or interaction traces when relevant;
- add new content with the required physical and temporal relationships.

For a multi-panel storyboard, determine panel order, distinguish concrete frame anchors from planning panels, map panels to shots, and decide whether the panels are physically simultaneous views or an editorial montage of distinct moments. Keep panel roles visually differentiated and exclude panel borders, gutters, numbers, annotations, captions, watermarks, or interface chrome unless requested.

Preserve exact dialogue, lyrics, visible text, punctuation, spelling, case, count, placement, and timing. Do not translate or improve user-provided wording. Keep on-screen speech, off-screen speech, voice-over, reused audio, timbre reference, persistent ambience, shot-local effects, and audience-only music distinct.

## 8. Long-video continuity

Activate only when one requested video's total duration exceeds 15 seconds. Requests from 4 through 15 seconds must remain one H3 clip even when they contain many shots, references, cuts, or beats. Multiple independently requested videos are separate requests, not segments of one video.

### 8.1 Duration allocation

Prefer the fewest valid 4–15 second clips and fill 15-second clips from the beginning:

- 30 seconds: `15 + 15`;
- 40 seconds: `15 + 15 + 10`;
- 45 seconds: `15 + 15 + 15`.

When a remainder is 1–3 seconds, borrow only enough time from the preceding segment to make the final segment 4 seconds. For example, 31 seconds becomes `15 + 12 + 4`. Respect a user's explicit valid split. A content-driven boundary may differ when it creates a safer action, dialogue, camera, or continuity handoff without increasing the clip count unnecessarily.

### 8.2 Boundary gate

Track each downstream dependency as:

1. `planned`: the real prior ending does not exist;
2. `inspected`: a real stable frame or useful ending-video portion exists and has been checked;
3. `finalized`: the next JSON has been reconciled with that real carrier and validated.

Do not call a downstream prompt final while its carrier is only planned. If all prompts are requested in advance, label dependent prompts as provisional outside their JSON objects and recompile them after the preceding result is inspected.

Choose a stable frame for a readable settled pose, product state, composition, or completed action. Choose an ending-video portion when motion, camera movement, liquid, particles, dialogue, music phase, or rhythm must continue. Never use a blurred, deformed, occluded, or ambiguous ending merely because it is last.

At every boundary, inspect identity, clothing, pose, handedness, grip, object count and state, motion direction, camera side and height, framing, focus, lighting, reflections, environment, emotion, ambience, and audio phase.

### 8.3 Photometric continuity

Compare the actual source splice, exported carrier, and downstream opening. Check luma, black and highlight levels, contrast, white balance, chroma, practical-light intensity, reflections, and available color metadata.

Use a color-managed export and reload it before generation. If geometry matches but the downstream opening has a small global exposure or white-balance difference, prefer a short keyframed post-production correction. Regenerate when the mismatch is large, spatially uneven, or caused by incompatible lighting. Do not use a dissolve when it doubles faces, hands, or objects.

Use `scripts/check_h3_seam.py` as a heuristic measurement aid only after media exists. It does not replace visual inspection or scopes.

## 9. Current operating limits

Apply these mechanical limits to one H3 clip:

- generated duration: 4–15 seconds;
- Base family: zero endpoint images for T2VA, one for I2VA or L2VA, two for FL2VA;
- Ref2VA: at most 9 images;
- Ref2VA: at most 3 videos, each 2–15 seconds, combined duration at most 15 seconds;
- Ref2VA: at most 3 audio files, each 2–15 seconds, combined duration at most 15 seconds;
- Ref2VA: at most 12 physical image, video, and audio files combined;
- when a `<Video N>` and `<Audio N>` are semantic tracks from the same uploaded video file, count that upload once toward the combined physical-file limit and place both labels in the same optional JSON Director `material_assets` ledger item;
- label-family limits and duration checks still apply to the semantic `<Video N>` / `<Audio N>` tracks themselves;
- audio cannot be the only Ref2VA input; include at least one image or video.

Do not enforce an undocumented prompt-character limit. Use the validator's optional `--max-characters` only when the actual interface or API supplies one.

Source preserved in the bundled official guides and checked against `https://github.com/MiniMax-AI/MiniMax-H3` on 2026-08-19.
