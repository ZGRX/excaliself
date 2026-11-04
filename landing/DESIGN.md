# Landing page design

## Brief

- Subject: Excaliself, self-hosted Excalidraw for teams (Team space, live collaboration, accounts, folders, search, trash, Postgres storage).
- Audience: developers and small teams who self-host tools (homelab, startups, agencies).
- Job: make the idea clear in 3 seconds, then get the visitor to copy the compose file or open GitHub.
- Assets: real product screenshots in `src/assets`, the iris logo, the product's Geist fonts.
- Scale: a product landing page. No loader, no WebGL, no smooth-scroll library. Craft goes into type, layout and one signature.

## Concepts

| | Idea | Anchor | Signature | O/F/Fe/P |
|---|---|---|---|---|
| A. Material | The page is a whiteboard sketch of where your drawings go. It draws itself, and your drawings travel along the arrow into a hand-drawn Postgres cylinder. | Drawings live in your own Postgres. The database cylinder is the shape everyone draws in Excalidraw architecture sketches. | Scroll sends drawing cards along the arrow into the cylinder, whose hachure fill rises. | 4 / 5 / 4 / 2 |
| B. Formal | The page is one infinite canvas; scroll pans a camera between frames, with a zoom readout. | Excalidraw is an infinite canvas. | Camera pans and zooms between section frames. | 3 / 4 / 3 / 3 |
| C. Place | The page is a terminal session on your server; each section is command output. | Self-hosting. | Commands type and print sections. | 2 / 3 / 5 / 4 |

Pick A: it explains the product's one promise (your drawings, your database) with the product's own material. From B: the 404 is an empty selection box on the canvas.

## Concept card

```
Idea:        The page is a whiteboard diagram of where your drawings live, and it draws itself as you read.
Metaphor:    An Excalidraw architecture sketch: rough boxes, arrows, a database cylinder, handwritten notes.
Signature:   Hero diagram (Mira, Tomasz and Priya → Excaliself → "your data", inside a dashed "your server"
             boundary). Strokes draw in on load; scrolling the hero sends each teammate's drawing along the
             arrows into the database, where it lands as a small card. The database keeps room to spare. Idle: a small autosave sheet travels the arrows every few seconds.
Emotion:     "Oh, that is literally how it works." Calm, legible, a little playful.
Motion verb: Drawn in like a marker stroke, then selected like an Excalidraw element.
Screenshot:  The hero: big headline, the sketch with a drawing mid-flight into the "pgdata" cylinder.
```

## System

**Palette** (Excalidraw's own canvas and default palette, plus the product's iris):
- ground `#ffffff` (Excalidraw canvas white)
- ink `#1e1e1e` (Excalidraw default stroke)
- muted `#5c5c66` (6.6:1 on ground)
- line `rgb(30 30 30 / 0.12)`
- accent iris `#6f66c9` (logo, selection box, 4.75:1), pen `#5f56c0` for handwritten notes
- sketch fills, diagrams only: blue `#a5d8ff`, green `#b2f2bb`, yellow `#ffec99`, red `#ffc9c9`, violet `#d0bfff`

**Type**
- Geist Variable (the product's face) for display, text and UI. Display 600, tracking -0.045em, leading 0.92.
- Excalifont (Excalidraw's hand font, OFL) for annotations and diagram labels only. Every note carries real information. The wordmark stays in Geist, like the logo.
- Geist Mono for the terminal.
- Scale: mega `clamp(3rem, 0.9rem + 7.4vw, 7.75rem)`, xl `clamp(2.25rem, 1.2rem + 4.2vw, 5rem)`, l `clamp(1.6rem, 1.2rem + 1.8vw, 2.75rem)`, body 17 to 18 px.

**Grid**: 12 columns, fluid gutter, max width 1440 px, outer margin = gutter. Text hangs from column 1 and column 8.
Rhythm: hero full height, tour airy, features normal, statement airy, deploy normal, FAQ tight, finale full.

**Shape**: UI radius 8 px (Excalidraw roundness), screenshots 12 px. Sketch shapes are rough.js with roughness 1.

**Motion**: one ease family (`expo.out` entrances, `power3.out` hovers). Strokes draw 0.7 to 1.1 s, stagger 40 ms.
Primary targets (CTAs, nav) answer with the Excalidraw selection box: a 1 px iris frame with four square handles
that settles in from 1.04 scale. The same box is the focus ring. Nav links draw a rough underline.
Everything runs on GSAP's ticker; native scroll (no Lenis, so anchors and find-in-page stay native).

## Composition

```
HERO (poster + diagram, sticky 165svh on desktop)
| H1 mega, cols 1-8                     | lede + CTAs, cols 9-12 |
| [drawings]  ──→  ┊ [Excaliself] ──→ (Postgres) ┊   full width  |

TOUR (annotated screenshot)
| h2 cols 1-6 |
| note |      home screenshot, cols 2-11       | note |
|        handwritten arrows into the image             |

FEATURES (5 pairs: editor, live, Team space, ⌘K, members; alternating, text always vertically centered)
| image cols 1-7         | text 9-12 |
| text 1-4 |   image cols 6-12       |

STATEMENT (text cols 1-7, "a home" circled; the Excalidraw window sits unchanged inside an Excaliself frame, cols 8-12)

DEPLOY (flowchart + terminal, then the one-command try-it)
| 3 rough step boxes ↓ ↓ | terminal |
| try it first: text     | terminal |

FAQ (h2 cols 1-4, list cols 6-12)

SPONSORS (text + GitHub Sponsors button cols 1-5; four dashed "your logo" slots cols 7-12)

FINALE (CTA, giant Geist wordmark, small links)
```

Phone (390 px): the diagram turns vertical and scrubs as it crosses the screen (no sticky). Below 1024 px the
tour shows only the sidebar, each short note beside its row with a small arrow. Pairs stack.

## Decisions

- Genericness check: a generic model would ship a centered hero, a purple glow and three feature cards.
  Changed: left-aligned poster headline, the diagram instead of a screenshot hero, no cards, pastel colors
  only inside sketches, iris used only for selection and notes.
- No loader or page transition theatre: static pages with plain navigation.
- Docs (`/docs/`): markdown in `src/content/docs`, listed in `src/lib/docs.ts`. Same tokens, smaller type. The current page in the sidebar is the selection box. No search until the page count asks for it.
- Idle state: the autosave sheet in the hero. The rest of the page is still at rest by choice.
- Under reduced motion: all strokes drawn, cards rest in the stack, cylinder shows its fill, no scrub.
