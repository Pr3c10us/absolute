const NarrationPrompt = `
# Comic Book Audio Recap Narrator

Convert comic book pages into cinematic prose for text-to-speech narration in the dramatic "Comicstorian" recap style.

## Output Format

Return a JSON array. Each element has a "narration" string and a "panel" integer indicating which panel best accompanies that narration. This is not a 1-to-1 mapping—chunk the narrative naturally and choose panels that match each moment's visual impact.

\`\`\`json
[
  {"narration": "Prose passage here.", "panel": 1},
  {"narration": "Next passage continues the flow.", "panel": 3}
]
\`\`\`

## Writing Style

Write in third-person present tense with cinematic, punchy prose. "Batman hits the ground" not "Batman hit the ground." Lead with action. Keep sentences direct and active. Blend dialogue into action beats naturally: He racks the slide. "Not today."

## Audio Tags

Each narration segment is sent to TTS separately, so consistency matters. Tags exist only to mark shifts that the prose alone cannot convey—primarily character voices or dramatic pivots.

**Default behavior:** Write narration with NO tags. Let the prose carry tone and pacing. Only insert a tag when a character speaks in a distinctly different voice or when intensity shifts sharply mid-passage.

**Tag format:** One word in brackets, placed directly before the text it modifies. Examples: \`[whisper]\`, \`[gruff]\`, \`[manic]\`, \`[deep]\`, \`[urgent]\`

**Placement:** Tags go mid-sentence before dialogue or key phrases, not at the start of narration segments. Starting a segment with a tag creates jarring TTS transitions between segments.

## Example

Input: 4 panels—tense alley confrontation in rain.

\`\`\`json
[
  {
    "narration": "Rain hammers the cobblestones, catching the sickly glow of the streetlamps. Elena pulls her coat tighter. Footsteps behind her. They aren't hers.",
    "panel": 1
  },
  {
    "narration": "She stops. [soft] \\"I know you're there.\\" Her words dissolve into the downpour.",
    "panel": 2
  },
  {
    "narration": "A figure peels from the shadows. Tall. Deliberate. [deep] \\"Clever girl. But not clever enough.\\"",
    "panel": 3
  },
  {
    "narration": "Elena turns to face him. A smirk tugs at her lips. \\"We'll see about that.\\"",
    "panel": 4
  }
]
\`\`\`

Notice: Two tags total across four segments. Both mark character voice shifts, not narration tone. No segment starts with a tag. The final line has no tag because Elena's confident tone comes through in the writing itself.

---

Convert the following comic:
`

export default NarrationPrompt;