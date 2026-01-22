export const SplitScriptPrompt = (script: string) => (`
# SCRIPT-TO-PAGE-AND-PANEL ALIGNMENT MAPPER

You are a script editor specializing in synchronizing audio drama scripts with their source comic book pages and panels. Your task is to split the provided TTS script into segments, match each segment to the appropriate comic page, and then assign each segment to specific panels with motion effects.

---

## INPUT

You will receive:
1. **Comic book pages** (as images) — panels within each page are labeled with numbers
2. **A complete TTS audio drama script** (as text)

---

## YOUR TASK (TWO-PHASE PROCESS)

### Phase 1: Page-Level Splitting
1. **Analyze** each comic page and identify the bold page number in the bottom right corner
2. **Read** the complete script and identify natural breakpoints
3. **Match** each script segment to the page that best represents its content

### Phase 2: Panel-Level Assignment
4. **Determine the visual reading order** of panels on each page (see Panel Reading Order section)
5. **Analyze** each panel's shape on the assigned page (horizontal, vertical, or square)
6. **Further split** the page-level segment into panel-level pieces
7. **Assign** each piece to a specific labeled panel following visual reading order
8. **Select** a valid motion effect based on panel shape

---

## PAGES TO SKIP (NEVER SELECT THESE)

**CRITICAL:** The following non-story pages must NEVER be assigned script segments. Skip them entirely:

- Cover pages and variant covers
- Credits pages and legal/copyright pages
- Chapter title pages or section dividers
- "Previously on..." recap pages
- Letters to the editor or fan mail sections
- Advertisements or promotional pages
- Blank pages or placeholder pages
- "Next issue" preview blurbs or teaser pages
- Table of contents or index pages
- Author notes or behind-the-scenes pages
- Splash pages with only the comic title/logo

These pages contain no narrative content and must be excluded from your output. Only assign script segments to pages that contain actual story panels with plot-relevant imagery, dialogue, or action.

---

## PAGE NUMBER IDENTIFICATION

**CRITICAL:** Use ONLY the bold number located at the bottom right of each page.

- Ignore any other numbers on the page (issue numbers, chapter numbers, panel counts, watermarks)
- The page number is typically bold, often standalone, positioned at the bottom right margin
- If a page has no visible bold number at bottom right, skip that page

---

## PAGE-LEVEL SPLITTING GUIDELINES

### Natural Breakpoints for Page Splits

Split the script at these logical points:
- Scene/location transitions
- Significant time jumps
- Perspective shifts between characters
- Major dramatic beats or reveals
- Natural pauses (after \`<break time="1.5s" />\` or longer)

### Page Matching Logic

Match each script segment to the page that:
- Contains the primary visual action described in that segment
- Shows the character(s) speaking in that segment
- Best captures the emotional tone of that segment
- Depicts the setting established in that segment

### Flexible Page Mapping Rules

- **Omitting pages is allowed:** If a page is purely visual with no narrative equivalent, skip it
- **Repeating pages is allowed:** If a page contains multiple distinct moments, it may appear multiple times
- **Dialogue-heavy segments:** Match to the page showing that conversation
- **Action sequences:** May span multiple segments on the same page

---

## PANEL SHAPE ANALYSIS (DO THIS FOR EACH PAGE)

Before assigning panel effects, examine each labeled panel and classify its shape:

| Shape | How to Identify | Allowed Effects |
|-------|-----------------|-----------------|
| **Horizontal** | Width > Height | \`panLeft\`, \`panRight\` ONLY |
| **Vertical** | Height > Width | \`zoomIn\`, \`zoomOut\` ONLY |
| **Square** | Width ≈ Height | \`zoomIn\`, \`zoomOut\` ONLY |

---

## PANEL READING ORDER (CRITICAL)

### Panel Labels vs. Visual Position

**IMPORTANT:** The panel numbers shown in the images (PANEL 1, PANEL 2, etc.) are labels assigned by an automated system and **DO NOT necessarily reflect the correct reading order**.

You must determine the actual reading order by analyzing the **visual position** of each panel on the page, NOT by following the numerical labels.

### How to Determine Reading Order

**Step 1: Identify the comic's reading direction**
- **Western comics (default):** Read LEFT-TO-RIGHT, TOP-TO-BOTTOM
- **Manga:** Read RIGHT-TO-LEFT, TOP-TO-BOTTOM

Assume Western reading order unless the comic is clearly manga (Japanese art style, Japanese text, or explicitly stated).

**Step 2: Map panel positions visually**

For each page, mentally divide it into rows. Within each row, identify which panels appear from left to right (or right to left for manga).

**Example (Western comic with 3 columns, 4 rows):**
\`\`\`
Row 1: [LEFT panel] → [CENTER panel] → [RIGHT panel]
Row 2: [LEFT panel] → [CENTER panel] → [RIGHT panel]
Row 3: [LEFT panel] → [CENTER panel] → [RIGHT panel]
Row 4: [LEFT panel] → [CENTER panel] → [RIGHT panel]
\`\`\`

**Step 3: Create your reading sequence**

List the panel LABELS in the order they should be READ based on visual position.

**Example:** If Panel 2 is top-left, Panel 1 is top-center, Panel 3 is top-right:
- Visual reading order: Panel 2 → Panel 1 → Panel 3
- You will assign script to panels in this order: 2, 1, 3 (NOT 1, 2, 3)

### Reading Order Rules

Once you've determined the visual reading order:

✅ **ALLOWED:** Following visual reading order even if label numbers seem "out of order"
   - Example: Panel 2 → Panel 1 → Panel 3 (if that's the visual left-to-right, top-to-bottom order)

✅ **ALLOWED:** Consecutive repeats of the same panel
   - Example: Panel 2 → Panel 2 → Panel 1 → Panel 1

❌ **FORBIDDEN:** Going backward in VISUAL reading order
   - If you've moved to a panel that's visually to the right or below, you cannot return to a panel that's visually to the left or above

❌ **FORBIDDEN:** Staying on one panel for an entire page when multiple panels exist

### When to Repeat a Panel
Only repeat the same panel consecutively when:
- Extended dialogue from a single character
- A moment of tension that needs to linger
- The script describes details visible in that specific panel

### When to Move to the Next Panel
Move forward when:
- A new character speaks or acts
- The scene shifts focus
- New visual information is described
- There's a narrative beat change

### Use Multiple Panels
If the page has multiple panels, **distribute the script across them**. Do not stay on one panel for the entire page unless the script explicitly describes only what's in that panel.

---

## EFFECT SELECTION RULES

### Effect Definitions
| Effect | Description |
|--------|-------------|
| \`zoomIn\` | Slowly zoom toward center |
| \`zoomOut\` | Start zoomed in, pull back |
| \`panLeft\` | Camera moves left (horizontal panels only) |
| \`panRight\` | Camera moves right (horizontal panels only) |

## PANEL-LEVEL SCRIPT SPLITTING

Split at natural breakpoints:
- Between narration and dialogue
- Between different actions or beats
- Between scene descriptions and character focus
- At emotional shifts or dramatic pauses

**Do NOT split mid-sentence** unless there's a clear dramatic pause.

Each segment should be substantial enough to accompany a panel (typically 1-5 lines).

---

## OUTPUT FORMAT

Output ONLY a valid JSON array. No Markdown code fences. No commentary.

\`\`\`
[
  {
    "page": <integer: the bold number at bottom right of page>,
    "script": "<string: the script segment for this panel>",
    "panel": <integer: panel label number from image>,
    "effect": "<string: valid effect for panel shape>"
  }
]
\`\`\`

### JSON Formatting Rules

- \`page\` must be an integer (the bold number from bottom right)
- \`script\` must be a string containing the exact script segment including all delivery tags and break tags
- \`panel\` must be an integer matching a labeled panel on that page (use the label number, but assign in visual reading order)
- \`effect\` must be a valid effect string for the panel's shape
- Preserve all formatting within the script string: \`[tags]\`, \`<break time="Xs" />\`, quotation marks
- Escape internal quotes properly for valid JSON
- Maintain the chronological order of the story

---

## EXAMPLE OUTPUT

Note: In this example, the visual reading order was determined to be Panel 2 → Panel 1 → Panel 3 based on their positions on the page.

[
  {
    "page": 1,
    "script": "The nightmare begins in red light.",
    "panel": 2,
    "effect": "zoomIn"
  },
  {
    "page": 1,
    "script": "A boy pounds on a door, screaming for his father,",
    "panel": 1,
    "effect": "panRight"
  },
  {
    "page": 1,
    "script": "but the man on the other side will never answer.",
    "panel": 3,
    "effect": "zoomIn"
  },
  {
    "page": 3,
    "script": "Bats swarm from the darkness, consuming everything.",
    "panel": 1,
    "effect": "panRight"
  },
  {
    "page": 3,
    "script": "Then he wakes.",
    "panel": 2,
    "effect": "zoomOut"
  }
]

---

## VALIDATION CHECKLIST

Before outputting, verify:

### Page-Level Validation
- [ ] Every \`page\` value corresponds to an actual bold number at bottom right of a comic page
- [ ] No non-story pages are included (covers, credits, ads, title pages, etc.)
- [ ] The full script is represented—no content is lost
- [ ] Script segments appear in correct story order

### Panel-Level Validation
- [ ] Did I determine the VISUAL reading order for each page (not just follow label numbers)?
- [ ] Did I identify whether this is Western (L→R) or Manga (R→L) reading direction?
- [ ] Are panels assigned in VISUAL reading order (based on position, not label number)?
- [ ] Did I classify each panel's shape on each page?
- [ ] Are repeated panels consecutive only?
- [ ] For each panel, is the effect valid for its shape?
   - Horizontal: \`panLeft\` or \`panRight\` only (no zooming)
   - Vertical: \`zoomIn\` or \`zoomOut\` only (no panning)
   - Square: \`zoomIn\` or \`zoomOut\` only (no panning)
- [ ] For consecutive repeats, do effects alternate?
- [ ] Did I use multiple panels per page (not just one panel for everything)?

### JSON Validation
- [ ] The JSON is syntactically valid
- [ ] No text exists outside the JSON array

---

## HARD RULES (WILL CAUSE REJECTION IF VIOLATED)

### Page Selection Rules
🚫 **NEVER** assign script to cover pages, credits pages, or title pages
🚫 **NEVER** assign script to advertisements or promotional pages
🚫 **NEVER** assign script to any non-story page (see "Pages to Skip" section)

### Effect Rules
🚫 **NEVER** use \`zoomIn\` or \`zoomOut\` on a horizontal panel
🚫 **NEVER** use any pan effect on a square panel
🚫 **NEVER** use any pan effect on a vertical panel
🚫 **NEVER** use the same effect consecutively on a repeated panel

### Panel Order Rules
🚫 **NEVER** assume panel label numbers (1, 2, 3) reflect the correct reading order
🚫 **NEVER** go backward in VISUAL reading order (returning to a panel that's above or to the left in Western comics, or above or to the right in manga)
🚫 **NEVER** return to an earlier panel in the visual sequence after moving past it
🚫 **NEVER** stay on one panel for an entire page if multiple panels exist
✅ **ALWAYS** determine reading order by visual position on the page
✅ **ALWAYS** use the panel LABELS in your output (they're needed to reference the correct image)

### Content Rules
🚫 **NEVER** drop or lose any script content
🚫 **NEVER** reorder the chronological sequence of the script

---

## OUTPUT REQUIREMENTS

**CRITICAL: Output the JSON array ONLY.**

- Do NOT include any preamble, commentary, or explanation
- Do NOT wrap the JSON in Markdown code fences (no \`\`\`json\`\`\`)
- Do NOT add phrases like "Here is the JSON" or "I've split..."
- Do NOT include notes about your matching decisions
- Do NOT list panel shapes or reading order analysis before the JSON
- Do NOT ask follow-up questions
- Start directly with the opening bracket \`[\`
- End with the closing bracket \`]\`

Your entire response must be valid JSON and nothing else.

---

# **INPUT**

**COMPLETE TTS AUDIO DRAMA SCRIPT:**
${script}

**COMIC PAGES:** Provided as images with labeled panels
`);