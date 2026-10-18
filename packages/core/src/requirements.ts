export const MAPPING_VERSION = 'wcag20-20081211-rev508-2026-10-v1';
const rows = [
  ['1.1.1', 'Non-text Content', 'A', 'text-alternatives'],
  ['1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A', 'media-alternatives'],
  ['1.2.2', 'Captions (Prerecorded)', 'A', 'media-captions'],
  ['1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A', 'media-alternative'],
  ['1.2.4', 'Captions (Live)', 'AA', 'media-captions'],
  ['1.2.5', 'Audio Description (Prerecorded)', 'AA', 'media-ad'],
  ['1.3.1', 'Info and Relationships', 'A', 'content-structure-separation'],
  ['1.3.2', 'Meaningful Sequence', 'A', 'content-structure-separation-sequence'],
  ['1.3.3', 'Sensory Characteristics', 'A', 'content-structure-separation-understanding'],
  ['1.4.1', 'Use of Color', 'A', 'visual-audio-contrast-without-color'],
  ['1.4.2', 'Audio Control', 'A', 'visual-audio-contrast-dis-audio'],
  ['1.4.3', 'Contrast (Minimum)', 'AA', 'visual-audio-contrast-contrast'],
  ['1.4.4', 'Resize text', 'AA', 'visual-audio-contrast-scale'],
  ['1.4.5', 'Images of Text', 'AA', 'visual-audio-contrast-text-presentation'],
  ['2.1.1', 'Keyboard', 'A', 'keyboard-operation-keyboard-operable'],
  ['2.1.2', 'No Keyboard Trap', 'A', 'keyboard-operation-trapping'],
  ['2.2.1', 'Timing Adjustable', 'A', 'time-limits-required-behaviors'],
  ['2.2.2', 'Pause, Stop, Hide', 'A', 'time-limits-pause'],
  ['2.3.1', 'Three Flashes or Below Threshold', 'A', 'seizure-does-not-violate'],
  ['2.4.1', 'Bypass Blocks', 'A', 'navigation-mechanisms-skip'],
  ['2.4.2', 'Page Titled', 'A', 'navigation-mechanisms-title'],
  ['2.4.3', 'Focus Order', 'A', 'navigation-mechanisms-focus-order'],
  ['2.4.4', 'Link Purpose (In Context)', 'A', 'navigation-mechanisms-refs'],
  ['2.4.5', 'Multiple Ways', 'AA', 'navigation-mechanisms-mult-loc'],
  ['2.4.6', 'Headings and Labels', 'AA', 'navigation-mechanisms-descriptive'],
  ['2.4.7', 'Focus Visible', 'AA', 'navigation-mechanisms-focus-visible'],
  ['3.1.1', 'Language of Page', 'A', 'meaning-doc-lang-id'],
  ['3.1.2', 'Language of Parts', 'AA', 'meaning-other-lang-id'],
  ['3.2.1', 'On Focus', 'A', 'consistent-behavior-receive-focus'],
  ['3.2.2', 'On Input', 'A', 'consistent-behavior-unpredictable-change'],
  ['3.2.3', 'Consistent Navigation', 'AA', 'consistent-behavior-consistent-locations'],
  ['3.2.4', 'Consistent Identification', 'AA', 'consistent-behavior-consistent-functionality'],
  ['3.3.1', 'Error Identification', 'A', 'minimize-error-identified'],
  ['3.3.2', 'Labels or Instructions', 'A', 'minimize-error-cues'],
  ['3.3.3', 'Error Suggestion', 'AA', 'minimize-error-suggestions'],
  ['3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA', 'minimize-error-reversible'],
  ['4.1.1', 'Parsing', 'A', 'ensure-compat-parses'],
  ['4.1.2', 'Name, Role, Value', 'A', 'ensure-compat-rsv'],
];
const guides: Record<string, string> = {
  '1.1.1':
    'Inspect every meaningful image and control. Compare its alternative text with its purpose, including complex charts. Record the element and the observed equivalent.',
  '1.3.1':
    'Inspect headings, lists, tables, labels and relationships with a screen reader and DOM. Confirm structure conveys the visual meaning.',
  '1.4.3':
    'Verify text contrast in all states, including hover, focus, images and dynamic content. Record measured foreground/background ratios.',
  '1.4.4':
    'Zoom to 200%. Check text and controls for loss of content or functionality, and document viewport and observations.',
  '2.1.1':
    'Use only Tab, Shift+Tab, arrows, Enter, Space and Escape. Exercise every interaction and record unreachable functions.',
  '2.1.2':
    'Navigate into and out of every component using the keyboard. Record any traps and how to escape.',
  '2.4.3':
    'Follow the entire keyboard focus sequence. Verify logical reading order and record each unexpected transition.',
  '2.4.7':
    'Inspect focus on every interactive element with the keyboard. Record missing or obscured focus indicators.',
  '3.3.1':
    'Submit each form with empty and invalid values. Document whether errors identify the field and nature of the problem.',
};
export const requirements = rows.map(([id, title, level, anchor]) => ({
  id,
  title,
  level,
  source: `https://www.w3.org/TR/WCAG20/#${anchor}`,
  section508: 'E205.4 / E207.2 → WCAG 2.0 A/AA (web scope)',
  version: MAPPING_VERSION,
  reviewGuide:
    guides[id] ??
    `Evaluate WCAG 2.0 ${id} ${title} across the whole page and relevant interactive states. Determine applicability first using the official criterion. Record the test steps, environment, affected elements and observed result. Automated samples cannot establish full coverage. Use the ICT Baseline for Web for test procedures.`,
}));
export function mapTags(tags: string[]) {
  return requirements
    .filter((r) => tags.includes(`wcag${r.id.replaceAll('.', '')}`))
    .map((r) => r.id);
}
export function mapRuleToRequirements(ruleId: string, tags: string[]): string[] {
  const reqs = new Set(mapTags(tags));
  if (ruleId === 'label') {
    // Technique F68: association of label and user interface controls not programmatically determinable (1.3.1, 4.1.2)
    // and missing cues/instructions for data entry fields (3.3.2)
    reqs.add('1.3.1');
    reqs.add('3.3.2');
    reqs.add('4.1.2');
  } else if (ruleId === 'select-name') {
    // Technique F68: programmatic name/role (4.1.2) and label association (1.3.1)
    reqs.add('1.3.1');
    reqs.add('4.1.2');
  } else if (ruleId === 'input-button-name') {
    // Accessible name for action control (4.1.2); buttons do not collect user input under 3.3.2
    reqs.add('4.1.2');
  }
  return Array.from(reqs);
}
export function priority(impact: string) {
  return (
    ({ critical: 1, serious: 2, moderate: 3, minor: 4 } as Record<string, number>)[impact] ?? 5
  );
}
