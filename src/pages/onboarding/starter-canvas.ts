import { ADAPTIVE_INK } from '@myelin/editor/canvas-theme';
import { ElementType } from '@myelin/editor/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { Messages } from '@/lib/i18n';
import type { Repository, VFSNodeId } from '@/lib/sync';

type StarterCopy = Messages['onboarding']['starter'];

// Where the markdown importer puts its page frame, mirrored here so the
// free-floating elements can be laid out to the right of the page.
const FRAME_X = 160;
const FRAME_Y = 80;
const PAGE_WIDTH = 680;
const CANVAS_COLUMN_X = FRAME_X + PAGE_WIDTH + 80;
const CANVAS_COLUMN_WIDTH = 420;

// Samples are the demonstration itself, so they stay out of the message
// catalogs: there is nothing in them to translate but the node labels.
const CODE_SAMPLE = [
  '```ts',
  'type Note = { title: string; tags: string[] };',
  '',
  'const taggedWith = (notes: Note[], tag: string) =>',
  '  notes.filter((note) => note.tags.includes(tag));',
  '```',
].join('\n');

const MATH_SAMPLE = [
  '$$',
  '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  '$$',
].join('\n');

const CANVAS_LATEX = '\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J}';

function mermaidSample(copy: StarterCopy): string {
  return [
    '```mermaid',
    'flowchart LR',
    `  A[${copy.diagramNodes.idea}] --> B[${copy.diagramNodes.note}]`,
    `  B --> C[${copy.diagramNodes.canvas}]`,
    '```',
  ].join('\n');
}

function buildMarkdown(copy: StarterCopy): string {
  return [
    `# ${copy.title}`,
    '',
    copy.intro,
    '',
    `> [!tip] ${copy.tipTitle}`,
    `> ${copy.tipBody}`,
    '',
    `## ${copy.codeHeading}`,
    '',
    copy.codeBody,
    '',
    CODE_SAMPLE,
    '',
    `## ${copy.mathHeading}`,
    '',
    copy.mathBody,
    '',
    MATH_SAMPLE,
    '',
    `## ${copy.diagramHeading}`,
    '',
    copy.diagramBody,
    '',
    mermaidSample(copy),
    '',
    `## ${copy.syntaxHeading}`,
    '',
    `| ${copy.syntaxColumns.type} | ${copy.syntaxColumns.get} |`,
    '| --- | --- |',
    `| \`- [ ]\` | ${copy.syntaxRows.checklist} |`,
    `| \`> [!note]\` | ${copy.syntaxRows.callout} |`,
    `| \`$$\` | ${copy.syntaxRows.math} |`,
    '',
    copy.linkTip,
    '',
    `## ${copy.mediaHeading}`,
    '',
    copy.mediaBody,
    '',
    `## ${copy.checklistHeading}`,
    '',
    `- [x] ${copy.checklistDone}`,
    `- [ ] ${copy.checklistTodo1}`,
    `- [ ] ${copy.checklistTodo2}`,
    '',
  ].join('\n');
}

function addText(
  ydoc: YDocManager,
  text: string,
  offsetY: number,
  fontSize: number,
  boxHeight: number,
): void {
  ydoc.createElementMap(ElementType.TEXT, crypto.randomUUID(), {
    offsetX: CANVAS_COLUMN_X,
    offsetY,
    scaleX: 1,
    scaleY: 1,
    text,
    color: ADAPTIVE_INK,
    fontSize,
    fontFamily: 'sans-serif',
    boxWidth: CANVAS_COLUMN_WIDTH,
    boxHeight,
  });
}

/**
 * The starter canvas: one page frame demonstrating the page features
 * people miss (code, math, mermaid, callouts, tables, embeds) and, beside it,
 * the free-floating text and LaTeX elements that only exist on the canvas.
 *
 * Built and encoded in one pass like {@link createBlankCanvasFile}, so no
 * session has to be opened to fill it in. Note links are left as literal
 * syntax in the table rather than real links: the file does not exist yet at
 * this point, so nothing they pointed at could resolve.
 */
export async function createStarterCanvasFile(
  repository: Repository,
  name: string,
  strings: Messages,
): Promise<VFSNodeId> {
  const copy = strings.onboarding.starter;
  const ydoc = new YDocManager();

  await addMarkdownPageFrameToYDoc(ydoc, buildMarkdown(copy), {
    offsetX: FRAME_X,
    offsetY: FRAME_Y,
    displayName: copy.frameName,
  });

  addText(ydoc, copy.canvas.heading, FRAME_Y + 16, 30, 48);
  addText(ydoc, copy.canvas.body, FRAME_Y + 84, 20, 120);
  addText(ydoc, copy.canvas.latexCaption, FRAME_Y + 236, 18, 40);

  ydoc.createElementMap(ElementType.LATEX, crypto.randomUUID(), {
    offsetX: CANVAS_COLUMN_X,
    offsetY: FRAME_Y + 296,
    scaleX: 1,
    scaleY: 1,
    latex: CANVAS_LATEX,
  });

  addText(ydoc, copy.canvas.toolbarHint, FRAME_Y + 404, 18, 80);

  return repository.createFile(name, 'mcanvas', null, ydoc.encodeState());
}
