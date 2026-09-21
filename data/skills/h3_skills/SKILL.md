name: h3-json-director
description: Create and validate editable community h3-director-json-v1 prompt plans for MiniMax H3 while preserving official T2VA, I2VA, FL2VA, L2VA, and Ref2VA semantics. Use for H3 text-to-video, endpoint-image generation, multimodal reference generation, video editing or continuation, storyboard, exact dialogue or visible text, beat-aware sequencing, and multi-segment continuity work.
---

# MiniMax H3 JSON Director


> **ToonFlow 备注**：这份文档提到的 `scripts/validate_h3_prompt.py`、`scripts/check_h3_seam.py` 并未随 ToonFlow 一起安装，相关校验步骤在这里不适用。ToonFlow 也不把 JSON 当作提示词发给 H3——实际发出去的是官方六字段纯文本，见 `data/modelPrompt/video/minimaxH3*.md`。

For each planned H3 clip, create one valid UTF-8 JSON object in the community `h3-director-json-v1` format. Use official MiniMax H3 semantics underneath the JSON structure. Treat the JSON as prompt text for H3, not as an H3 API request body, the hosted H3-Context-IR output, or an official MiniMax schema.

This is a community-maintained extension. Read `NOTICE` and `LICENSE-MINIMAX-H3` before redistribution.

## Use the bundled authorities

Apply this order to semantic decisions:

1. Current explicit user requirements.
2. Facts visible in media that is actually available and inspected.
3. The official H3 guide for the selected mode.
4. JSON Director planning guidance.
5. JSON Director defaults.

The machine-readable JSON Schema independently governs output structure. If a request cannot be represented without violating it, explain the conflict instead of inventing fields or enum values.

Use these files:

- Read [base-en.txt](references/base-en.txt) for T2VA, I2VA, FL2VA, or L2VA.
- Read [ref-en.txt](references/ref-en.txt) for Ref2VA. Also read the relevant sections of `base-en.txt` for camera, shots, speakers, dialogue, visible text, sound, and music.
- Read [enhancement-rules.md](references/enhancement-rules.md) for dense, multimodal, editing, continuation, exact-text, synchronized, or multi-segment tasks.
- Treat [h3-director-json-v1.schema.json](references/h3-director-json-v1.schema.json) as the structural source of truth.

Never let the JSON Director layer change official mode meanings, reference labels, task types, preservation relationships, dialogue tags, speaker numbering, or sound/music separation.

The official guides describe semantic intent and are not the JSON Director output template. Ignore their legacy plain-text section layout and example word-count targets when serializing the final prompt; map the underlying meaning into the current JSON Schema instead.

## Build the prompt

### 1. Inspect and normalize the request

Determine:

- target duration and aspect ratio;
- available text, images, videos, and audio;
- the primary responsibility of each asset;
- exact dialogue, lyrics, visible text, requested changes, preserved facts, and explicit exclusions;
- whether the result is one 4–15 second H3 clip or a longer sequence.

Inspect available media. Do not infer unseen content from filenames. Ask one critical question only when the answer changes the H3 mode, material mapping, or intended result. Otherwise make the smallest reasonable assumption and continue.

For image inputs, maintain a private asset ledger in actual upload order before assigning semantic roles. Record what each image visibly contains, its primary responsibility, and which semantic subjects or concrete frame anchors it supports. The first uploaded image is `<Picture 1>`, the second is `<Picture 2>`, and so on; do not renumber them according to importance or first use in the JSON.

If the user describes an asset that is not yet available for inspection, use only the user's explicit description, state outside the JSON that material facts and duration remain uninspected, and avoid adding visual details that were not supplied. The JSON may still be structurally valid, but actual material limits and fidelity remain provisional until the asset is attached.

For a missing duration, infer a conservative duration only when the visible action and spoken content make the choice low-risk. For source-video editing, inherit an inspected source duration only when it fits 4–15 seconds. Ask when a missing continuation length or incompatible duration materially changes the task.

### Duration routing gate

Apply this gate before selecting shots, references, rhythm, or story structure:

- If the requested total duration is between 4 and 15 seconds inclusive, create exactly one H3 clip and exactly one final JSON object whose `format.duration_seconds` equals that total duration.
- Never split a 4–15 second request because it has multiple images, multiple subjects, many shots, rapid cuts, beat synchronization, a dense storyboard, or a complex Ref2VA relationship. Represent those changes as multiple items inside the single JSON object's `storyboard`.
- A shot is an internal camera/editing interval inside one generated clip. It is not a separately generated H3 clip. Six shots in a 10-second request still produce one 10-second JSON object.
- Split one requested video only when its total duration exceeds 15 seconds. If the user asks for multiple independent 4–15 second videos, treat each as a separate request rather than splitting one total-duration video.
- When a 4–15 second request appears overloaded, keep it as one clip and warn or ask about simplifying its internal storyboard. Do not solve density by secretly creating multiple generation calls.

### 2. Decompose what is locked before choosing a mode

Do not treat an image, video, or audio file as one indivisible reference instruction. First convert the request into independent responsibility axes. For each relevant axis, decide whether it is **anchored**, **preserved**, **guided**, or **free**:

- **identity**: character, product, object, wardrobe, or other reusable visible identity;
- **environment**: the world or setting that should remain recognizable;
- **composition**: exact spatial arrangement, framing, layout, pose, or endpoint image geometry;
- **motion**: action path, camera behavior, editing rhythm, or temporal structure;
- **appearance**: lighting language, palette, texture, graphic treatment, or style;
- **audio**: copied signal, voice, music, rhythm, ambience, or sound character.

Apply these meanings consistently:

- **anchored** means a concrete frame, time, source video, or audio signal must be used at a specific structural position;
- **preserved** means the semantic identity or world must remain recognizable while new poses, framings, or local details may be generated as allowed;
- **guided** means the source influences the result but is not a hard continuity obligation;
- **free** means H3 may invent that axis within the user's brief.

A single high-completion asset may visibly contain identity, environment, composition, typography, pose, lighting, and style at once. Do **not** automatically preserve all of them. Encode only the responsibilities required by the user. This prevents a strong reference from unintentionally dragging every shot back toward the same pose or composition. Conversely, do not release the environment merely to gain variety when the setting itself is part of the requested world.

Treat **environment identity** and **composition identity** as separate concepts. Preserving an environment means keeping the same semantic world, location family, atmosphere, and required stable spatial facts. It does not by itself require the same camera position, subject placement, prop layout, or exact source framing. Lock those only through a concrete frame or `composition_reference` when the user actually wants them.

### 3. Select exactly one official mode per JSON object

Choose the mode from **structural anchoring**, not merely from the presence of an uploaded image:

- `T2VA`: text-only generation with no material reference.
- `I2VA`: the user wants one supplied image to be the literal opening frame or wants the generated motion to continue directly from that exact visible frame. Use exactly one opening-frame `<Picture 1>` at `0.0` seconds.
- `FL2VA`: the user wants supplied images to be the literal opening and ending frames. Use `<Picture 1>` at `0.0` and `<Picture 2>` at the total duration.
- `L2VA`: the user wants one supplied image to be the literal ending frame. Use exactly one ending-frame `<Picture 1>` at the total duration.
- `Ref2VA`: material is used semantically or temporally without requiring it to be a literal endpoint, or the task uses identity, environment, style, pose, action, camera, rhythm, storyboard, keyframe, source-video editing/continuation, or audio references.

An uploaded image does **not** imply I2VA. If the user wants to preserve what the image depicts while allowing a newly invented opening composition, use Ref2VA. If the user says to animate the exact image, continue from it, or keep it as frame zero, use the appropriate endpoint mode. Ask one critical question only when this distinction cannot be inferred and materially changes the result.

When an endpoint anchor and additional independent references are both required, use Ref2VA and preserve the concrete endpoint through `<Picture N>` while mapping the other responsibilities separately.

Aspect ratio, resolution, and interface-side runtime settings do not determine the H3 semantic mode. Record the requested creative format, but route the mode from anchoring and reference responsibilities.

### 4. Map references by responsibility

Use official labels only:

- `<Picture N>` for a concrete frame, keyframe, composition anchor, or storyboard anchor.
- `<Subject N>` for a reusable semantic responsibility abstracted from source assets: character, product, object/prop, environment, wardrobe, style, action, or pose.
- `<Video N>` for the actual source video, continuation source, or temporal/camera/editing/rhythm reference.
- `<Audio N>` for an actual audio signal that is copied or referenced.

Map common responsibilities deliberately:

- use `character_identity`, `product_identity`, `object_identity`, `wardrobe_identity`, or `environment_identity` to preserve **what something or somewhere is** without automatically preserving its source pose or layout;
- use `composition_reference` only when source arrangement, framing, or layout should influence the new shot;
- use `pose_reference` or `action_reference` when pose or motion itself is the transferable responsibility;
- use `style_reference` only when the source image itself must guide appearance beyond what can be stated cleanly in `direction.visual_style`;
- use `object_identity` for reusable props or accessories; never invent a non-schema role such as `prop_identity`.

When one physical asset supplies several responsibilities, separate them semantically only when those responsibilities are genuinely needed. Do not create a strong `style_reference`, `environment_identity`, and `composition_reference` from the same high-completion image by default. That combination can over-bind the generation. Prefer the smallest responsibility set that preserves the user's intent.

For environment references, describe the **world envelope** that must remain stable: location family, time/weather when important, major atmosphere, and required recurring spatial facts. Let individual shots explore different zones, blocking, distances, and camera angles inside that world unless the user locks them.

Number each label family independently from 1 without gaps. Give each reference one primary `role`. For `<Subject N>`, list the raw asset labels in `sources`; do not create redundant standalone Picture or Video entries when those assets only supply the subject.

For Ref2VA, use the optional top-level `material_assets` ledger only when provenance would otherwise be ambiguous, especially when one uploaded video supplies both `<Video N>` and an enabled synchronized `<Audio N>` track. Do not add the ledger for routine one-file-to-one-label image inputs. Put `<Video N>` and `<Audio N>` in the same ledger item when they come from the same uploaded video; put genuinely separate files in different items. Material-file limits are counted by distinct ledger items, while label-family numbering remains semantic and independent.

Keep raw image numbering distinguishable from semantic subject numbering. A raw `<Picture N>` remains the user-uploaded image label even when it appears only inside a `<Subject N>.sources` list and therefore has no standalone entry in `references`.

Use `relationship` only in Ref2VA when preservation or transfer must be explicit. Use visual relationships only for Picture, Video, and Subject labels; use audio relationships only for Audio labels. Match the relationship to the role rather than choosing only by media family: concrete opening/ending/keyframes use `fully_preserved` or `partially_preserved`; composition/storyboard references and structural camera/editing/rhythm references may use `fully_preserved`, `partially_preserved`, or `weak_reference`; direct `source_video` and `continuation_source` entries use `fully_preserved` or `partially_preserved`; action/subject transfer roles may also use `attribute_transfer` when characteristics intentionally move to a different identifiable target. Audio reuse uses `fully_copy` or `partially_copy`; non-copy audio guidance uses `reference` or `weak_reference`.

Every `keyframe` is a concrete time-local anchor: use `scope: "shot_specific"`, exactly one target shot, and an `at_seconds` value that falls inside that shot.

### 5. Compose the director JSON

Use only the top-level modules allowed by the Schema:

```json
{
  "schema": "h3-director-json-v1",
  "format": {},
  "material_assets": [],
  "references": [],
  "direction": {},
  "storyboard": [],
  "audio": {},
  "exclusions": []
}
```

Omit optional modules and fields when they do not apply. Never output empty optional arrays.

Write `direction` as a concise global director brief:

- describe the main visible concept in `concept`;
- describe the image language in `visual_style`;
- add subject, environment, rhythm, and continuity only when useful;
- state stable facts positively instead of repeating negative constraints.

Default to the shortest sufficient brief. State each global fact once. Preserve the user's central result and real invariants, then leave unrequested blocking, connective motion, micro-expression, lens choice, and transition details open for H3 to solve.

Use **English structure with Chinese descriptive content by default**:

- Keep all JSON keys, Schema-defined enum values, official mode names, relationship values, task-type markers, reference roles, and reference-label syntax exactly as defined. This includes `schema`, `format`, `mode`, `references`, `storyboard`, `camera`, `action`, `audio`, `exclusions`, `T2VA`, `I2VA`, `FL2VA`, `L2VA`, `Ref2VA`, `opening_frame`, and labels such as `<Picture N>`, `<Subject N>`, `<Video N>`, and `<Audio N>`.
- Write natural-language descriptions in Simplified Chinese by default. This applies to reference `description`; `direction.concept`, `visual_style`, `subject`, `environment`, `visual_rhythm`, and `continuity`; every storyboard shot's `camera`, `action`, and `sfx`; `audio.overall_soundscape`; `audio.non_diegetic_music`; and natural-language items in `exclusions`.
- Standard H3, camera, and editing terminology may remain in English inside Chinese sentences when that wording is clearer or more precise, such as `Tracking Shot`, `Push In`, `Arc Shot`, `whip-pan`, `speed ramp`, `cut on beat`, `split-screen`, and `flash frame`. Do not translate fixed tags or markers such as `<d>`, `<scenetrans>`, `<cutoff>`, `(S1)`, or the language name inside `[Language]`.
- Preserve exact dialogue, lyrics, brand strings, interface text, and other visible text in the language and wording specified by the user or present in the source material. The default Chinese description policy never authorizes translating these exact strings.
- If the user explicitly requests English output, write the complete natural-language descriptive content in English instead. Exact dialogue, lyrics, and visible text still remain in their specified or source language.

When runtime duration is set by the user's generation workflow, do not repeat exact seconds or time ranges in reference descriptions, `direction` prose, storyboard `camera` / `action` / `sfx`, or audio prose. Include natural-language timing only when the user requests an exact synchronized event, keyframe, dialogue or lyric boundary, or beat cue.

If the user explicitly says that workflow settings own runtime and asks for no time in the prompt at all, first build and validate the normal Director JSON internally, then derive one timing-free workflow execution JSON for delivery. Remove `schema`, `format.duration_seconds`, every reference `at_seconds`, and every storyboard `start_seconds` / `end_seconds` from that execution copy. Do not label the stripped copy as `h3-director-json-v1` or claim that it passes the Director Schema: it is a downstream prompt serialization, while the undisclosed or separately retained full Director JSON remains the validation source. Keep validator behavior and the canonical Schema unchanged.

The bundled official guides remain authoritative for H3 semantics. Chinese descriptive prose is a community JSON Director serialization policy rather than an official MiniMax output requirement. Preserve the official meaning and every fixed structural value; use English descriptive content whenever the user explicitly requests it.

Write `storyboard` in playback order. Every shot must include:

- sequential `shot` number;
- numeric `start_seconds` and `end_seconds`;
- one natural `camera` instruction;
- an `action` that is visually readable and serves the shot's function: normally a causal before-to-after event, but for a deliberate editorial insert or composite beat it may instead be a concise distinct detail, micro-event, or panel montage that advances information or rhythm;
- shot-local `sfx`, using `N/A` when intentionally absent.

Use shot-level `references`, `dialogue`, and `visible_text` only when needed. A global reference already applies across the clip and should normally be omitted from shot `references`; repeat it locally only when a specific shot needs disambiguation. Keep each instruction at the narrowest useful scope. Do not repeat global appearance, environment, or style in every shot.

For spoken content:

- assign stable `S1`, `S2`, and later IDs by first vocal event;
- preserve user-provided words, language, and punctuation;
- store the line as `<d>[Language] exact words</d>`;
- keep delivery, physical action, and speaker identity outside the `<d>` block;
- preserve official `<scenetrans>` and `<cutoff>` behavior when required.

For sound:

- put persistent ambience in `audio.overall_soundscape`;
- put audience-only music in `audio.non_diegetic_music`;
- put physical, shot-local sounds in each shot's `sfx`;
- add `sync_basis` only for planned beats, actual audio reference, or actual audio reuse;
- never claim reference-audio precision when no `<Audio N>` exists.

Use `exclusions` only for an explicit user prohibition, a visible source artifact that must be removed, or one high-cost failure that cannot be expressed clearly as a positive target. Prefer positive state descriptions such as “全片只有一辆黑色轿车” over lists of “不要增加、不要复制、不要切换”. Do not preserve the history of earlier failed renders as a growing negative-prompt list.

### 6. Direct with selective control

Translate the user's central intention into visible or audible evidence, then stop when the prompt is sufficient. Preserve physical causality and continuity positively, but do not narrate every intermediate frame or pre-solve every camera decision.

Use this priority order when instructions compete:

1. exact user must-haves, dialogue, lyrics, visible text, and endpoint anchors;
2. identity, required object count, environment, and other true continuity invariants;
3. the dominant action, emotional turn, product result, or rhythmic accent of the shot;
4. optional camera texture, decorative transitions, secondary gestures, and micro-timing.

Release priority 4 first when a clip is dense. Combine or simplify secondary actions before adding more prohibitions. Warn before dropping a priority 1 requirement.

Treat storyboard times as broad playback intervals unless exact synchronization is required. A continuity shot normally needs one dominant action or state change and one clear camera relationship. Let H3 invent natural connective movement, micro-expression, local blocking, and ordinary cut resolution. Very short shots are appropriate for readable inserts or accents, not for multi-step physical choreography.

Review adjacent shots only for accidental state contradiction, unexplained object-count change, reversed action without motivation, or an unintended restart of the same action. Repetition, matching composition, or a return angle is allowed when it serves rhythm, continuity, emphasis, or a deliberate callback. Do not force every shot to be globally unique.

For fast work, establish a simple density curve and choose the smallest effective editing vocabulary. One or two devices—such as fixed-camera crossings plus inserts, or cut-on-beat plus one speed ramp—are usually clearer than listing cuts, split screens, whip-pans, speed ramps, flashes, and camera moves together. Use `audio.sync_basis` only when a planned beat or real audio reference exists.

Describe a specific transition only when it carries identity, geometry, motion, dialogue, audio phase, or a user-requested effect across the cut. Otherwise a plain cut is sufficient. Specify the ending tightly only when the user needs an endpoint, handoff, text lockup, or exact terminal action; otherwise state its purpose and allow H3 to compose the final image.

Do not force a story formula, BPM, shot count, lens package, cut rhythm, climax, or transition buffer. Preserve the requested outcome while leaving every unclaimed axis free.

### 7. Handle requests longer than 15 seconds

Activate this section only after the duration routing gate has established that one requested video's total duration exceeds 15 seconds. Never apply it to a 4–15 second video request.

Create one independently valid JSON object per H3 clip. Prefer the fewest clips. Filling 15-second clips from the beginning is only the generic fallback; when a specialized workflow or content-aware review supplies an explicit valid split at a safer dialogue, lyric, bar, action, camera, or continuity boundary, preserve that split without increasing the clip count unnecessarily. Place a valid 4–15 second remainder last. If the remainder is 1–3 seconds, borrow enough time from the preceding clip to make the final clip at least 4 seconds. Respect an explicit valid user split. The sum of every JSON object's `format.duration_seconds` must equal the requested total duration.

Treat a downstream clip that depends on an ungenerated boundary asset as provisional. Finalize it only after inspecting the previous clip's real ending and selecting a stable frame or useful ending-video portion. Choose the carrier from motion needs, not from a mandatory last-two-second rule. Preserve geometry, object state, motion vector, camera, lighting, and audio phase across the boundary.

Use [check_h3_seam.py](scripts/check_h3_seam.py) only as a photometric aid after real clips exist. It does not replace visual inspection.

## Validate before delivery

Write the draft to a JSON file and run:

```powershell
python scripts/validate_h3_prompt.py --input "prompt.json"
```

Before delivering any single- or multi-clip plan, validate the requested total duration separately:

```powershell
python scripts/validate_h3_prompt.py --requested-total-duration 10 --segment-durations 10
```

For a request above 15 seconds, pass every planned clip duration, for example `--requested-total-duration 20 --segment-durations 15,5`. A 4–15 second video request must validate as exactly one segment equal to the requested duration. Use `--allow-explicit-split` when the user chooses a non-default split or when a documented content-aware review selects a safer boundary. State an agent-selected non-default split outside the JSON so the user can see why it differs from the generic 15-second-first allocation.

Pass `--video-durations` and `--audio-durations` when Ref2VA uses those real assets so their operating limits can be checked. Duration lists follow `<Video N>` and `<Audio N>` label order, even when a Video and Audio label share one physical `material_assets` ledger item. A Ref2VA `<Audio N>` marked `fully_copy` must match the target video duration because the complete source audio becomes the complete final audio track; otherwise use `partially_copy` or revise the target/audio plan. Add `--json` only when a machine-readable validation report is useful.

Fix every `ERROR` and validate again. Treat `WARNING` as a review signal, not an automatic failure. Never change the user's creative intent merely to remove a warning.

When one or more image inputs are used, place a concise Chinese `素材映射` immediately before the JSON file link or JSON deliverable unless the user explicitly requests raw JSON only. Use one line per image in upload order:

```text
素材映射：
- 图1（<Picture 1>）：[可见内容]；主要用途：[素材职责]；对应：[<Subject N> 或具体构图/关键帧职责]。
- 图2（<Picture 2>）：[可见内容]；主要用途：[素材职责]；对应：[<Subject N> 或具体构图/关键帧职责]。
```

Describe observable content rather than repeating the filename. State every semantic subject supported by the image when useful. If the raw image only supplies a `<Subject N>` and has no standalone `references` entry, say so through the mapping without inventing a standalone Picture role. Keep the Chinese mapping outside the JSON so the validated H3 prompt remains one pure JSON object.

Deliver exactly one validated JSON prompt per planned H3 clip, not multiple alternate versions for the same clip. A request longer than 15 seconds therefore produces one validated JSON object for each planned segment. Do not include Markdown fences, planning notes, requirement ledgers, risk scores, or validation notes inside any JSON object. For image-input tasks, the Chinese asset mapping above is the permitted user-facing preface; omit it only when the user explicitly asks for raw JSON with no surrounding text. When useful, add one short line outside the JSON summarizing mode, duration, shot count, references, and remaining warnings.

## Boundaries

- Do not output the former `h3-plus-final-json-v1`, a Director Plan, or the official-looking natural-language field template as the JSON Director deliverable.
- Do not use Seedance `@` reference syntax or import Seedance platform limits.
- Do not claim this community schema is official or that structural validation guarantees generation quality.
- Do not invent product functions, hidden mechanisms, asset facts, dialogue, brand text, or unsupported material roles.
- Do not silently rewrite a user-edited JSON during validation; report errors and repair only when asked or when generating the prompt within this workflow.
