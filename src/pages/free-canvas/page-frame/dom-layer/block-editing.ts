import { BlockType, BlockTypeRegistry } from '../block-types';
import { getBlockStyle, getBlockText, readBlockType } from './block-dom';

// ── Helpers ─────────────────────────────────────────────────

/** Clear all inline styles and apply the styles for the given block type. */
function setBlockType(div: HTMLDivElement, type: BlockType): void {
  div.dataset.blockType = String(type);
  div.style.cssText = '';
  Object.assign(div.style, getBlockStyle(type));
}

function placeCursorAtEnd(div: HTMLDivElement): void {
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(div);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function findBlockDivFromNode(
  startNode: Node,
  container: HTMLDivElement,
): HTMLDivElement | null {
  let node: Node | null = startNode;
  while (node && node !== container) {
    if (
      node instanceof HTMLDivElement &&
      node.parentElement === container &&
      !node.dataset.pageBreak
    ) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function findBlockDiv(
  range: Range,
  container: HTMLDivElement,
): HTMLDivElement | null {
  return findBlockDivFromNode(range.startContainer, container);
}

/** Check whether the cursor sits at the very start of a block's editable content. */
function isCursorAtStart(div: HTMLDivElement, range: Range): boolean {
  if (range.startContainer === div) {
    // Cursor directly in the div — only decorations may precede it
    for (let i = 0; i < range.startOffset; i++) {
      const child = div.childNodes[i];
      if (!(child instanceof HTMLElement && child.contentEditable === 'false')) {
        return false;
      }
    }
    return true;
  }

  // Cursor inside a text node past offset 0 → not at start
  if (range.startContainer instanceof Text && range.startOffset > 0) {
    return false;
  }

  // Walk up from the cursor's container to the block div, checking that
  // nothing editable precedes us at each level.
  let node: Node | null = range.startContainer;
  while (node && node !== div) {
    let prev = node.previousSibling;
    while (prev) {
      if (prev instanceof HTMLElement && prev.contentEditable === 'false') {
        prev = prev.previousSibling;
        continue;
      }
      return false;
    }
    node = node.parentNode;
  }
  return true;
}

/** Nuke all content and reset to an empty paragraph. */
function revertToParagraph(div: HTMLDivElement): void {
  setBlockType(div, BlockType.PARAGRAPH);
  div.innerHTML = '';
  div.appendChild(document.createElement('br'));
  placeCursorAtEnd(div);
}

function insertBlockAfter(
  currentDiv: HTMLDivElement,
  container: HTMLDivElement,
  type: BlockType,
): HTMLDivElement {
  const def = BlockTypeRegistry.get(type);
  const newDiv = document.createElement('div');
  setBlockType(newDiv, type);
  const decoration = def.createDecoration();
  if (decoration) {
    newDiv.appendChild(decoration);
  }
  newDiv.appendChild(document.createElement('br'));

  let insertBefore = currentDiv.nextSibling;
  while (
    insertBefore instanceof HTMLDivElement &&
    insertBefore.dataset.pageBreak
  ) {
    insertBefore = insertBefore.nextSibling;
  }
  if (insertBefore) {
    container.insertBefore(newDiv, insertBefore);
  } else {
    container.appendChild(newDiv);
  }
  return newDiv;
}

// ── Cross-block input ───────────────────────────────────────

/**
 * Intercept any input (delete, type-over, cut, etc.) whose selection spans
 * multiple block divs. The browser's default handling of cross-block edits
 * corrupts block state (styles, data-blockType), so we replace the affected
 * content with a clean paragraph ourselves.
 *
 * Intended to be called from a `beforeinput` listener.
 */
export function handleCrossBlockInput(
  e: InputEvent,
  container: HTMLDivElement,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) return false;

  const range = sel.getRangeAt(0);

  // Check if the selection spans more than one block div
  let blockCount = 0;
  for (const child of container.children) {
    if (!(child instanceof HTMLDivElement) || child.dataset.pageBreak) continue;
    if (range.intersectsNode(child)) blockCount++;
    if (blockCount > 1) break;
  }
  if (blockCount <= 1) return false;

  e.preventDefault();

  container.innerHTML = '';
  const div = document.createElement('div');
  setBlockType(div, BlockType.PARAGRAPH);
  if (e.data) {
    div.appendChild(document.createTextNode(e.data));
  } else {
    div.appendChild(document.createElement('br'));
  }
  container.appendChild(div);
  placeCursorAtEnd(div);
  return true;
}

// ── Markdown shortcuts ───────────────────────────────────────

export function checkMarkdownShortcut(div: HTMLDivElement): boolean {
  // Only trigger on plain paragraph blocks — prevents re-triggering on
  // already-styled blocks whose state was corrupted by contentEditable.
  if (readBlockType(div) !== BlockType.PARAGRAPH) {
    return false;
  }

  const text = div.textContent ?? '';
  for (const [type, def] of BlockTypeRegistry.all()) {
    const trigger = def.markdownTrigger;
    if (trigger?.test(text)) {
      setBlockType(div, type);

      div.innerHTML = '';
      const decoration = def.createDecoration();
      if (decoration) {
        div.appendChild(decoration);
      }
      div.appendChild(document.createElement('br'));

      placeCursorAtEnd(div);
      return true;
    }
  }
  return false;
}

// ── Backspace handling ──────────────────────────────────────

/** Strip zero-width and other invisible characters that contentEditable leaves behind. */
function hasVisibleText(div: HTMLDivElement): boolean {
  return getBlockText(div).replace(/[\u200B-\u200D\uFEFF]/g, '').length > 0;
}

/**
 * On Backspace, handle two cases:
 * 1. Non-paragraph block — revert to paragraph (empty block: any cursor pos;
 *    block with text: cursor must be at start).
 * 2. Paragraph whose previous sibling is a capturesEnter block — prevent the
 *    browser from merging the paragraph back into the code block.
 */
export function handleBackspace(
  e: KeyboardEvent,
  container: HTMLDivElement,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) {
    return false;
  }

  const range = sel.getRangeAt(0);
  const currentDiv = findBlockDiv(range, container);
  if (!currentDiv) return false;

  const blockType = readBlockType(currentDiv);
  const atStart = isCursorAtStart(currentDiv, range);
  const hasText = hasVisibleText(currentDiv);

  // ── Paragraph after a capturesEnter block (e.g., code block) ──
  // Prevent the browser from merging this block into the code block.
  if (blockType === BlockType.PARAGRAPH) {
    if (!atStart && hasText) return false;

    let prev = currentDiv.previousSibling;
    while (prev instanceof HTMLDivElement && prev.dataset.pageBreak) {
      prev = prev.previousSibling;
    }
    if (prev instanceof HTMLDivElement) {
      const prevDef = BlockTypeRegistry.get(readBlockType(prev));
      if (prevDef.capturesEnter) {
        e.preventDefault();
        if (!hasText) currentDiv.remove();
        placeCursorAtEnd(prev);
        return true;
      }
    }
    return false;
  }

  // ── Non-paragraph block: revert to paragraph ──
  // Empty block → revert regardless of cursor position.
  // Block with text → only revert when cursor is at the very start.
  if (hasText && !atStart) return false;

  e.preventDefault();

  if (hasText) {
    // Strip the formatting but keep content.
    setBlockType(currentDiv, BlockType.PARAGRAPH);
    for (const child of Array.from(currentDiv.childNodes)) {
      if (child instanceof HTMLElement && child.contentEditable === 'false') {
        child.remove();
      }
    }
    const newRange = document.createRange();
    newRange.selectNodeContents(currentDiv);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return true;
  }

  // Empty — nuke everything including invisible browser artifacts.
  revertToParagraph(currentDiv);
  return true;
}

// ── Code-block exit ─────────────────────────────────────────

/** Check if the cursor is on the last line of a block (no <br> after cursor). */
function isCursorOnLastLine(div: HTMLDivElement, range: Range): boolean {
  if (range.startContainer === div) {
    // Everything from cursor offset to end must be only trailing <br> placeholders
    for (let i = range.startOffset; i < div.childNodes.length; i++) {
      const child = div.childNodes[i];
      if (child instanceof HTMLElement && child.contentEditable === 'false') {
        continue;
      }
      if (!(child instanceof HTMLBRElement)) return false;
    }
    return true;
  }

  if (range.startContainer instanceof Text) {
    // Must be the last text node — everything after it should be only <br>
    let node: Node | null = range.startContainer.nextSibling;
    while (node) {
      if (node instanceof HTMLElement && node.contentEditable === 'false') {
        node = node.nextSibling;
        continue;
      }
      if (!(node instanceof HTMLBRElement)) return false;
      node = node.nextSibling;
    }
    return true;
  }

  return false;
}

/**
 * Exit a capturesEnter block (code block): move cursor to the next block,
 * creating a paragraph if needed.
 * When `requireLastLine` is true (ArrowDown), only exits if cursor is on the
 * last line. When false (Mod+Enter), exits unconditionally.
 */
export function handleCodeBlockExit(
  e: KeyboardEvent,
  container: HTMLDivElement,
  requireLastLine = false,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);
  const currentDiv = findBlockDiv(range, container);
  if (!currentDiv) return false;

  const def = BlockTypeRegistry.get(readBlockType(currentDiv));
  if (!def.capturesEnter) return false;

  if (requireLastLine && !isCursorOnLastLine(currentDiv, range)) return false;

  e.preventDefault();

  // Find or create the next block after the code block
  let next = currentDiv.nextSibling;
  while (next instanceof HTMLDivElement && next.dataset.pageBreak) {
    next = next.nextSibling;
  }

  let targetDiv: HTMLDivElement;
  if (next instanceof HTMLDivElement && !next.dataset.pageBreak) {
    targetDiv = next;
  } else {
    targetDiv = insertBlockAfter(currentDiv, container, BlockType.PARAGRAPH);
  }

  const newRange = document.createRange();
  newRange.selectNodeContents(targetDiv);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return true;
}

// ── Captured Enter (code blocks) ────────────────────────────

function handleCapturedEnter(
  currentDiv: HTMLDivElement,
  container: HTMLDivElement,
  sel: Selection,
  range: Range,
): void {
  // Empty block → revert to paragraph
  if (getBlockText(currentDiv).length === 0) {
    revertToParagraph(currentDiv);
    return;
  }

  // Exit condition: last two editable children are <br> and cursor is
  // between them (user pressed Enter on an empty trailing line).
  const children = currentDiv.childNodes;
  if (
    children.length >= 2 &&
    children[children.length - 1] instanceof HTMLBRElement &&
    children[children.length - 2] instanceof HTMLBRElement &&
    range.startContainer === currentDiv &&
    range.startOffset >= children.length - 1
  ) {
    // Trim trailing <br> elements
    while (currentDiv.lastChild instanceof HTMLBRElement) {
      currentDiv.removeChild(currentDiv.lastChild);
    }
    if (!currentDiv.hasChildNodes()) {
      currentDiv.appendChild(document.createElement('br'));
    }

    // Create a new paragraph after the code block
    const newDiv = insertBlockAfter(currentDiv, container, BlockType.PARAGRAPH);
    const newRange = document.createRange();
    newRange.selectNodeContents(newDiv);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return;
  }

  // Insert <br> for a new line within the block
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);

  // Ensure a trailing <br> placeholder so the cursor is visible on the new line
  if (!br.nextSibling) {
    currentDiv.appendChild(document.createElement('br'));
  }

  const newRange = document.createRange();
  newRange.setStartAfter(br);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

// ── Enter key ────────────────────────────────────────────────

export function handleEnterKey(
  e: KeyboardEvent,
  container: HTMLDivElement,
): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }

  const range = sel.getRangeAt(0);
  const currentDiv = findBlockDiv(range, container);
  if (!currentDiv) {
    return;
  }

  e.preventDefault();

  const blockType = readBlockType(currentDiv);
  const def = BlockTypeRegistry.get(blockType);

  // Blocks that capture Enter (e.g., code blocks) — insert line break within
  // the block instead of creating a new block.
  if (def.capturesEnter) {
    handleCapturedEnter(currentDiv, container, sel, range);
    return;
  }

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  let lastTextNode: Node | null = null;
  for (let i = currentDiv.childNodes.length - 1; i >= 0; i--) {
    const child = currentDiv.childNodes[i];
    if (child instanceof HTMLElement && child.contentEditable === 'false') {
      continue;
    }
    lastTextNode = child;
    break;
  }
  if (lastTextNode) {
    if (lastTextNode instanceof Text) {
      afterRange.setEnd(lastTextNode, lastTextNode.length);
    } else {
      afterRange.setEndAfter(lastTextNode);
    }
  } else {
    afterRange.setEndAfter(currentDiv.lastChild ?? currentDiv);
  }

  const afterContent = afterRange.extractContents();
  const hasTextLeft = getBlockText(currentDiv).length > 0;
  if (!hasTextLeft) {
    for (let i = currentDiv.childNodes.length - 1; i >= 0; i--) {
      const child = currentDiv.childNodes[i];
      if (child instanceof HTMLElement && child.contentEditable === 'false') {
        continue;
      }
      currentDiv.removeChild(child);
    }
    currentDiv.appendChild(document.createElement('br'));
  }

  // Empty continuing block (e.g., empty list item) reverts to paragraph
  if (def.continuesOnEnter && !hasTextLeft) {
    setBlockType(currentDiv, BlockType.PARAGRAPH);
    for (const child of Array.from(currentDiv.childNodes)) {
      if (child instanceof HTMLElement && child.contentEditable === 'false') {
        child.remove();
      }
    }
    const newRange = document.createRange();
    newRange.selectNodeContents(currentDiv);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return;
  }

  const newType = def.continuesOnEnter ? blockType : BlockType.PARAGRAPH;
  const newDef = BlockTypeRegistry.get(newType);
  const newDiv = document.createElement('div');
  setBlockType(newDiv, newType);

  const decoration = newDef.createDecoration();
  if (decoration) {
    newDiv.appendChild(decoration);
  }

  const hasAfterContent =
    afterContent.textContent && afterContent.textContent.length > 0;
  if (hasAfterContent) {
    newDiv.appendChild(afterContent);
  } else {
    newDiv.appendChild(document.createElement('br'));
  }

  // Insert after current div, skipping any page-break spacer
  let insertBefore = currentDiv.nextSibling;
  while (
    insertBefore instanceof HTMLDivElement &&
    insertBefore.dataset.pageBreak
  ) {
    insertBefore = insertBefore.nextSibling;
  }
  if (insertBefore) {
    container.insertBefore(newDiv, insertBefore);
  } else {
    container.appendChild(newDiv);
  }

  const newRange = document.createRange();
  let targetNode: Node = newDiv;
  for (const child of newDiv.childNodes) {
    if (child instanceof HTMLElement && child.contentEditable === 'false') {
      continue;
    }
    targetNode = child;
    break;
  }
  if (targetNode instanceof Text) {
    newRange.setStart(targetNode, 0);
  } else {
    newRange.selectNodeContents(newDiv);
    newRange.collapse(true);
  }
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}
