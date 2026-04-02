import { BlockType, BlockTypeRegistry } from '../block-types';
import { getBlockStyle, readBlockType } from './block-dom';

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
      if (
        !(child instanceof HTMLElement && child.contentEditable === 'false')
      ) {
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
  if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) {
    return false;
  }

  const range = sel.getRangeAt(0);

  // Check if the selection spans more than one block div
  let blockCount = 0;
  for (const child of container.children) {
    if (!(child instanceof HTMLDivElement) || child.dataset.pageBreak) {
      continue;
    }
    if (range.intersectsNode(child)) {
      blockCount++;
    }
    if (blockCount > 1) {
      break;
    }
  }
  if (blockCount <= 1) {
    return false;
  }

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
  const def = BlockTypeRegistry.get(readBlockType(div));
  return def.readText(div).replace(/[\u200B-\u200D\uFEFF]/g, '').length > 0;
}

/**
 * On Backspace at the start of a non-paragraph block, revert it to a paragraph.
 * Empty blocks revert regardless of cursor position; blocks with text only
 * revert when the cursor is at the very start.
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
  if (!currentDiv) {
    return false;
  }

  const blockType = readBlockType(currentDiv);
  const atStart = isCursorAtStart(currentDiv, range);
  const hasText = hasVisibleText(currentDiv);

  if (blockType === BlockType.PARAGRAPH) {
    return false;
  }

  // ── Non-paragraph block: revert to paragraph ──
  // Empty block → revert regardless of cursor position.
  // Block with text → only revert when cursor is at the very start.
  if (hasText && !atStart) {
    return false;
  }

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
  const hasTextLeft = def.readText(currentDiv).length > 0;
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
