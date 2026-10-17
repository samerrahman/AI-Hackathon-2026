# Asset guide

## Included files

### miso-expression-atlas.png

Production-oriented PNG expression atlas, 1536 × 1024 pixels, RGBA with transparent gutters/background. Three columns and two rows, each cell 512 × 512 pixels. The alpha channel was inspected; the atlas is not an opaque screenshot of a checkerboard.

| Frame | Column / row | Expression | Typical use |
| --- | --- | --- | --- |
| 0 | 0 / 0 | Neutral attentive | Idle and listening |
| 1 | 1 / 0 | Thinking | A short processing pause |
| 2 | 2 / 0 | Speaking | Audio playback / speech animation |
| 3 | 0 / 1 | Puzzled | Clarification, used sparingly |
| 4 | 1 / 1 | Pleased | Acknowledging a correction |
| 5 | 2 / 1 | Blink / eyes closed | Optional blink or calm pause |

Use the rectangles in `asset-manifest.json`. The atlas is designed for client-side clipping or texture regions. The files have not been sliced into separate images. A developer can keep the atlas as one unchanged asset and render the appropriate cell.

The generated poses are visually consistent but not a pixel-perfect rig. Do not expect smooth skeletal interpolation or accurate phoneme lip sync. Keep the character small enough that subtle differences do not distract. A static neutral frame is an acceptable accessible fallback.

For a square clipping viewport, the conceptual full-atlas scale is three viewport widths by two viewport heights. Choose the relevant 512-pixel cell in source coordinates. Verify that no neighboring character or background gutter leaks into the visible frame. Do not show the entire atlas as the application mascot.

### study-workspace-reference.png

1536 × 1024 illustrative interface reference. It shows the design direction after a source hint has been revealed: warm paper, navy typography, restrained orange, a dominant note surface, and a companion panel. It is not functioning UI and not a precise layout specification.

Build the screen as real components. Its generated paragraph text is not authoritative mathematics; use the actual PDF content. In particular, do not reuse informal phrases from the image as a substitute for a proof. The written specification determines interaction timing: a hint should not be revealed before the user needs it.

The screenshot's mascot is a different presentation pose of the same identity. Use the expression atlas in the actual app; do not crop the UI screenshot to create production assets.

### miso-character-concept.png

Original 1536 × 1024 character concept board. Use it as identity reference for future art: apricot fuzzy body, coral antennae, large dark eyes, midnight navy varsity jacket with cream details. It includes promotional text and is not a transparent mascot cutout.

## Motion plan

Implement motion in application code after the core learning flow works. Suggested sequence when a correction is accepted: stop speaking state, switch to pleased, perform one small nod/bounce, then settle to neutral. Respect reduced motion. Never turn the intentional-error state into an obvious “wrong answer” facial expression that gives away the exercise.

A coarse speaking animation can alternate speaking and neutral frames during audio activity. That should be described accurately as a speaking animation, not lip sync. A richer future character would need a dedicated layered rig or a proper viseme set.

## Future image generation

Use the supplied concept or atlas as an identity reference. Generate only art assets and decorative illustrations. Render exact diagrams, plots, equations, and source annotations with code or faithful source content. Do not rely on image generation for mathematical accuracy.

Prefer a small consistent set of states over dozens of vaguely matching pictures. Preserve face, jacket, proportions, lighting, pose scale, and baseline across new frames. Request true alpha transparency for cutouts.

See `GENERATION_PROMPTS.md` for the prompts used. These images were produced with the built-in image-generation tool; they were copied unchanged into this pack. No application animation is included yet.
