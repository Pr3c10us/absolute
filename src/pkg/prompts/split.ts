export const ScriptToPageAndPanelPrompt = (script: string) => (`
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
4. **Analyze** each panel's shape on the assigned page (horizontal, vertical, or square)
5. **Further split** the page-level segment into panel-level pieces
6. **Assign** each piece to a specific labeled panel
7. **Select** a valid motion effect based on panel shape

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
| **Horizontal** | Width > Height | \`none\`, \`zoomIn\`, \`zoomOut\`, \`panLeft\`, \`panRight\` |
| **Vertical** | Height > Width | \`none\`, \`zoomIn\`, \`zoomOut\`, \`panUp\`, \`panDown\` |
| **Square** | Width ≈ Height | \`zoomIn\`, \`zoomOut\` ONLY |

---

## PANEL SELECTION RULES

### Reading Order (MANDATORY)
Within each page, panels MUST be assigned in reading order: 1 → 2 → 3 → 4, etc.

❌ **FORBIDDEN**: Panel 1 → Panel 3 → Panel 2 (going backward)
❌ **FORBIDDEN**: Panel 2 → Panel 4 → Panel 2 (returning to earlier panel)
✅ **ALLOWED**: Panel 1 → Panel 1 → Panel 2 → Panel 2 → Panel 3 (consecutive repeats, forward progress)

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
If the page has multiple panels, **distribute the script across them**. Do not stay on panel 1 for the entire page unless the script explicitly describes only what's in panel 1.

---

## EFFECT SELECTION RULES

### Effect Definitions
| Effect | Description |
|--------|-------------|
| \`none\` | Static, no motion |
| \`zoomIn\` | Slowly zoom toward center |
| \`zoomOut\` | Start zoomed in, pull back |
| \`panLeft\` | Camera moves left (horizontal panels only) |
| \`panRight\` | Camera moves right (horizontal panels only) |
| \`panUp\` | Camera moves up (vertical panels only) |
| \`panDown\` | Camera moves down (vertical panels only) |

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
    "panel": <integer: panel number from image>,
    "effect": "<string: valid effect for panel shape>"
  }
]
\`\`\`

### JSON Formatting Rules

- \`page\` must be an integer (the bold number from bottom right)
- \`script\` must be a string containing the exact script segment including all delivery tags and break tags
- \`panel\` must be an integer matching a labeled panel on that page
- \`effect\` must be a valid effect string for the panel's shape
- Preserve all formatting within the script string: \`[tags]\`, \`<break time="Xs" />\`, quotation marks
- Escape internal quotes properly for valid JSON
- Maintain the chronological order of the story

---

## EXAMPLE OUTPUT

[
  {
    "page": 1,
    "script": "The nightmare begins in red light.",
    "panel": 1,
    "effect": "zoomIn"
  },
  {
    "page": 1,
    "script": "A boy pounds on a door, screaming for his father,",
    "panel": 2,
    "effect": "panDown"
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
- [ ] The full script is represented—no content is lost
- [ ] Script segments appear in correct story order

### Panel-Level Validation
- [ ] Did I classify each panel's shape on each page?
- [ ] Are panels in reading order within each page (no going backward)?
- [ ] Are repeated panels consecutive only?
- [ ] For each panel, is the effect valid for its shape?
   - Horizontal: no \`panUp\`/\`panDown\`
   - Vertical: no \`panLeft\`/\`panRight\`
   - Square: \`zoomIn\` or \`zoomOut\` only (no \`none\`, no panning)
- [ ] For consecutive repeats, do effects alternate?
- [ ] Did I use multiple panels per page (not just panel 1 for everything)?

### JSON Validation
- [ ] The JSON is syntactically valid
- [ ] No text exists outside the JSON array

---

## HARD RULES (WILL CAUSE REJECTION IF VIOLATED)

### Effect Rules
🚫 **NEVER** use \`panUp\` or \`panDown\` on a horizontal panel
🚫 **NEVER** use \`panLeft\` or \`panRight\` on a vertical panel
🚫 **NEVER** use any pan effect on a square panel
🚫 **NEVER** use \`none\` on a square panel (must be \`zoomIn\` or \`zoomOut\`)
🚫 **NEVER** use the same effect consecutively on a repeated panel

### Panel Order Rules
🚫 **NEVER** go backward in panel order within a page (3 → 2)
🚫 **NEVER** return to an earlier panel after moving past it
🚫 **NEVER** stay on panel 1 for an entire page if multiple panels exist

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
- Do NOT list panel shapes before the JSON
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