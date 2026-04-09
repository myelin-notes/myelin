import type {
  MarkType,
  NodeType,
  Node as PMNode,
  Schema,
} from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';

const markdownKey = new PluginKey('markdownAutoFormat');

interface InlineSpec {
  delim: string;
  markType: MarkType;
}

interface BlockSpec {
  prefix: string;
  nodeType: NodeType;
  attrs?: Record<string, unknown>;
}

interface Range {
  start: number;
  end: number;
}

interface Pair {
  openStart: number;
  contentStart: number;
  contentEnd: number;
  closeEnd: number;
}

/**
 * Whether every text character in the parent's `[from, to)` range carries
 * the given mark. Returns false if the range contains a non-text node, the
 * range is empty, or any character is missing the mark.
 */
function allCharsHaveMark(
  parent: PMNode,
  from: number,
  to: number,
  markType: MarkType,
): boolean {
  if (from < 0 || to > parent.content.size || from >= to) {
    return false;
  }
  let ok = true;
  parent.forEach((child, offset) => {
    if (!ok) {
      return;
    }
    const childStart = offset;
    const childEnd = offset + child.nodeSize;
    if (childEnd <= from || childStart >= to) {
      return;
    }
    if (!child.isText) {
      ok = false;
      return;
    }
    if (!child.marks.some((m) => m.type === markType)) {
      ok = false;
    }
  });
  return ok;
}

/** Contiguous runs of `markType` in the parent's direct children. */
function findMarkRanges(parent: PMNode, markType: MarkType): Range[] {
  const ranges: Range[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  parent.forEach((child, offset) => {
    const has = child.isText && child.marks.some((m) => m.type === markType);
    if (has) {
      if (runStart === null) {
        runStart = offset;
      }
      runEnd = offset + child.nodeSize;
    } else if (runStart !== null) {
      ranges.push({ start: runStart, end: runEnd });
      runStart = null;
    }
  });
  if (runStart !== null) {
    ranges.push({ start: runStart, end: runEnd });
  }
  return ranges;
}

function overlapsAny(
  from: number,
  to: number,
  ranges: readonly Range[],
): boolean {
  for (const r of ranges) {
    if (from < r.end && to > r.start) {
      return true;
    }
  }
  return false;
}

/** Next `delim` at-or-after `fromIdx` whose span doesn't overlap `claimed`. */
function findUnclaimedDelim(
  text: string,
  delim: string,
  fromIdx: number,
  claimed: readonly Range[],
): number {
  let i = fromIdx;
  while (true) {
    i = text.indexOf(delim, i);
    if (i < 0) {
      return -1;
    }
    if (!overlapsAny(i, i + delim.length, claimed)) {
      return i;
    }
    i++;
  }
}

/**
 * Every complete `delim…content…delim` pair in `text`, skipping pairs
 * whose delimiters fall inside any claimed range. Empty pairs and pairs
 * containing newlines/non-text markers are skipped.
 */
function findPairs(
  text: string,
  delim: string,
  claimed: readonly Range[],
): Pair[] {
  const pairs: Pair[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const openIdx = findUnclaimedDelim(text, delim, searchFrom, claimed);
    if (openIdx < 0) {
      break;
    }
    const closeIdx = findUnclaimedDelim(
      text,
      delim,
      openIdx + delim.length,
      claimed,
    );
    if (closeIdx < 0) {
      break;
    }

    const contentStart = openIdx + delim.length;
    const contentEnd = closeIdx;
    if (contentStart >= contentEnd) {
      searchFrom = closeIdx + delim.length;
      continue;
    }
    const inner = text.slice(contentStart, contentEnd);
    if (inner.includes('\n') || inner.includes('\ufffc')) {
      searchFrom = closeIdx + delim.length;
      continue;
    }
    pairs.push({
      openStart: openIdx,
      contentStart,
      contentEnd,
      closeEnd: closeIdx + delim.length,
    });
    searchFrom = closeIdx + delim.length;
  }
  return pairs;
}

/**
 * Whether every expected `mdDelim`-marked text marker is still in place
 * inside `parent`. Used to detect a broken heading prefix or codeBlock
 * fence — when this returns false, the block should be reverted.
 */
function blockMarkersValid(
  parent: PMNode,
  text: string,
  expected: ReadonlyArray<{ pos: number; chars: string }>,
  delimMark: MarkType,
): boolean {
  for (const { pos, chars } of expected) {
    if (pos < 0 || pos + chars.length > text.length) {
      return false;
    }
    if (text.slice(pos, pos + chars.length) !== chars) {
      return false;
    }
    if (!allCharsHaveMark(parent, pos, pos + chars.length, delimMark)) {
      return false;
    }
  }
  return true;
}

interface ReconcileContext {
  parent: PMNode;
  blockStart: number;
  text: string;
  newDoc: PMNode;
  delimMark: MarkType | undefined;
  tr: Transaction;
}

/**
 * Reconcile one mark type with what the parent text says it should be.
 *
 * - For every expected pair found in text, ensure the formatting mark and
 *   the surrounding `mdDelim` marks are present.
 * - For every existing mark range that ISN'T in the expected set, remove
 *   it if it was markdown-applied (one neighbouring delimiter still in
 *   place, or the other has been claimed by a higher-precedence code
 *   span). Toolbar-applied marks (no neighbouring `mdDelim`) are left
 *   alone.
 *
 * `canBeStolen` controls whether the mark's delimiters are eligible to be
 * "stolen" by an overlapping code span (true for emphasis, false for code
 * itself).
 */
function reconcileInlineSpec(
  spec: InlineSpec,
  expectedPairs: Pair[],
  codeRanges: readonly Range[],
  canBeStolen: boolean,
  ctx: ReconcileContext,
): boolean {
  const { parent, blockStart, text, newDoc, delimMark, tr } = ctx;
  if (!parent.type.allowsMarkType(spec.markType)) {
    return false;
  }

  let modified = false;
  const dlen = spec.delim.length;
  const expectedKeys = new Set(
    expectedPairs.map((p) => `${p.contentStart},${p.contentEnd}`),
  );

  // ---- Removal ----
  // Existing mark ranges that don't correspond to a found pair are
  // candidates for removal. We only act when there's evidence the mark
  // was markdown-applied — at least one neighbouring delim still bears
  // the mdDelim mark.
  if (delimMark) {
    for (const range of findMarkRanges(parent, spec.markType)) {
      if (expectedKeys.has(`${range.start},${range.end}`)) {
        continue;
      }

      const beforeStart = range.start - dlen;
      const afterEnd = range.end + dlen;
      const beforeText =
        beforeStart >= 0 ? text.slice(beforeStart, range.start) : '';
      const afterText =
        afterEnd <= text.length ? text.slice(range.end, afterEnd) : '';

      // Strict mdDelim check: the surviving delimiter span must be exactly
      // `dlen` chars wide. If adjacent chars are also mdDelim'd, they
      // belong to a different mark (e.g. an adjacent bold close next to a
      // toolbar italic) and shouldn't count as "this mark's" delim.
      const beforeHasDelim =
        beforeText === spec.delim &&
        allCharsHaveMark(parent, beforeStart, range.start, delimMark) &&
        (beforeStart === 0 ||
          !allCharsHaveMark(parent, beforeStart - 1, beforeStart, delimMark));
      const afterHasDelim =
        afterText === spec.delim &&
        allCharsHaveMark(parent, range.end, afterEnd, delimMark) &&
        (afterEnd >= parent.content.size ||
          !allCharsHaveMark(parent, afterEnd, afterEnd + 1, delimMark));

      const beforeStolen =
        canBeStolen &&
        beforeHasDelim &&
        overlapsAny(beforeStart, range.start, codeRanges);
      const afterStolen =
        canBeStolen &&
        afterHasDelim &&
        overlapsAny(range.end, afterEnd, codeRanges);

      const beforeOk = beforeHasDelim && !beforeStolen;
      const afterOk = afterHasDelim && !afterStolen;

      if (beforeOk && afterOk) {
        continue; // intact
      }
      if (!beforeHasDelim && !afterHasDelim) {
        continue; // toolbar — leave alone
      }

      tr.removeMark(
        blockStart + range.start,
        blockStart + range.end,
        spec.markType,
      );
      if (beforeOk) {
        tr.removeMark(
          blockStart + beforeStart,
          blockStart + range.start,
          delimMark,
        );
      }
      if (afterOk) {
        tr.removeMark(blockStart + range.end, blockStart + afterEnd, delimMark);
      }
      modified = true;
    }
  }

  // ---- Application ----
  // For every expected pair, make sure the formatting mark and both
  // mdDelim spans are in place. We compute each piece independently so a
  // pre-existing toolbar mark inside `*…*` text picks up its mdDelim
  // styling on the next pass.
  for (const pair of expectedPairs) {
    const docContentStart = blockStart + pair.contentStart;
    const docContentEnd = blockStart + pair.contentEnd;

    if (!newDoc.rangeHasMark(docContentStart, docContentEnd, spec.markType)) {
      tr.addMark(docContentStart, docContentEnd, spec.markType.create());
      modified = true;
    }
    if (delimMark) {
      if (
        !allCharsHaveMark(parent, pair.openStart, pair.contentStart, delimMark)
      ) {
        tr.addMark(
          blockStart + pair.openStart,
          blockStart + pair.contentStart,
          delimMark.create(),
        );
        modified = true;
      }
      if (
        !allCharsHaveMark(parent, pair.contentEnd, pair.closeEnd, delimMark)
      ) {
        tr.addMark(
          blockStart + pair.contentEnd,
          blockStart + pair.closeEnd,
          delimMark.create(),
        );
        modified = true;
      }
    }
  }

  return modified;
}

/**
 * Markdown auto-format. After every user-driven text change we scan the
 * parent textblock for markdown patterns and apply formatting WITHOUT
 * consuming the delimiter characters. The delimiters get the `mdDelim`
 * mark, which renders them visually muted via CSS — so the user can still
 * see, edit, and delete them like normal text.
 *
 *   inline: `code`, **bold**, *italic*, ~~strikethrough~~
 *   block:  `# `, `## `, `### ` (headings) and `` ``` `` (code block)
 *
 * Architecture:
 *   1. Block-level revert (Phase A) — heading or codeBlock whose mdDelim
 *      markers are broken collapses back to paragraph(s).
 *   2. Paragraph → heading creation (Phase E) — fires the moment the
 *      cursor sits exactly past a heading prefix.
 *   3. Paragraph → codeBlock fence merge (Phase F) — fires when typing
 *      the closing ``` paragraph after a matching opener.
 *   4. Inline reconciliation — for each inline mark spec, find every
 *      expected pair in the text, then ensure the marks match. Code spans
 *      have the highest precedence and claim ranges that subsequent
 *      emphasis specs must skip (matching CommonMark).
 *
 * Reconciliation handles BOTH creation and deletion uniformly: a mark
 * range is added if its pair exists in text and missing in marks, and
 * removed if it was markdown-applied but its pair no longer exists. The
 * mdDelim mark is the source of truth for "this character is a markdown
 * trigger" — toolbar-applied marks have no surrounding mdDelim and are
 * left alone.
 */
export function markdownAutoFormatPlugin(s: Schema): Plugin {
  // Bold/italic/strike, longer delimiters first so `**` is tested before
  // `*`. Code is processed separately because it has the highest
  // precedence and builds the `claimed` ranges that emphasis specs use.
  const emphasisSpecs: InlineSpec[] = [
    { delim: '**', markType: s.marks.bold },
    { delim: '~~', markType: s.marks.strikethrough },
    { delim: '*', markType: s.marks.italic },
  ];

  // Longer prefixes first so `### ` beats `## ` beats `# `. Code blocks
  // are handled separately by Phase F — they need a closing fence, not
  // just a single prefix.
  const blockSpecs: BlockSpec[] = [
    { prefix: '### ', nodeType: s.nodes.heading, attrs: { level: 3 } },
    { prefix: '## ', nodeType: s.nodes.heading, attrs: { level: 2 } },
    { prefix: '# ', nodeType: s.nodes.heading, attrs: { level: 1 } },
  ];

  const codeMark = s.marks.code;
  const delimMark = s.marks.mdDelim;

  return new Plugin({
    key: markdownKey,
    appendTransaction(transactions, _oldState, newState) {
      // React only to user-driven doc changes — never to our own generated
      // transactions, to avoid re-entrant loops.
      const userChange = transactions.some(
        (tr) => tr.docChanged && !tr.getMeta(markdownKey),
      );
      if (!userChange) {
        return null;
      }

      const { selection } = newState;
      if (!selection.empty) {
        return null;
      }

      const $cursor = selection.$from;
      const parent = $cursor.parent;
      if (!parent.isTextblock) {
        return null;
      }

      const blockStart = $cursor.start();
      const cursorOffset = $cursor.parentOffset;
      // textBetween joins inline content with `\ufffc` placeholders for
      // non-text children, so character offsets stay aligned with PM
      // positions.
      const text = parent.textBetween(
        0,
        parent.content.size,
        undefined,
        '\ufffc',
      );

      // ===== PHASE A: block-level revert =====
      // A heading or codeBlock whose mdDelim'd markers have been
      // (partially) deleted collapses back to plain block(s). The
      // `wasMarkdownCreated` check distinguishes blocks created by this
      // plugin from blocks the user made via the toolbar.
      if (
        delimMark &&
        (parent.type === s.nodes.heading || parent.type === s.nodes.codeBlock)
      ) {
        const first = parent.firstChild;
        const wasMarkdownCreated =
          !!first?.isText && first.marks.some((m) => m.type === delimMark);
        if (wasMarkdownCreated) {
          if (parent.type === s.nodes.heading) {
            const level = parent.attrs.level as number;
            const prefix = `${'#'.repeat(level)} `;
            if (
              !blockMarkersValid(
                parent,
                text,
                [{ pos: 0, chars: prefix }],
                delimMark,
              )
            ) {
              const tr = newState.tr;
              tr.removeMark(
                blockStart,
                blockStart + parent.content.size,
                delimMark,
              );
              tr.setBlockType(blockStart, blockStart, s.nodes.paragraph);
              tr.setMeta(markdownKey, true);
              return tr;
            }
          } else {
            // codeBlock — opening fence must still be at the start AND
            // some mdDelim'd ``` run must still exist after it. The
            // closing fence isn't pinned to the end so the user can keep
            // typing past it (e.g. pressing Enter after the closing
            // fence) without losing the block.
            let fencesOk = false;
            if (
              text.startsWith('```') &&
              allCharsHaveMark(parent, 0, 3, delimMark)
            ) {
              for (let i = 3; i + 3 <= text.length; i++) {
                if (
                  text.slice(i, i + 3) === '```' &&
                  allCharsHaveMark(parent, i, i + 3, delimMark)
                ) {
                  fencesOk = true;
                  break;
                }
              }
            }
            if (!fencesOk) {
              const paragraphs = text
                .split('\n')
                .map((line) =>
                  s.nodes.paragraph.create(
                    null,
                    line.length > 0 ? s.text(line) : null,
                  ),
                );
              const tr = newState.tr;
              const blockBefore = $cursor.before();
              const blockAfter = $cursor.after();
              tr.replaceWith(blockBefore, blockAfter, paragraphs);
              tr.setSelection(
                TextSelection.near(tr.doc.resolve(blockBefore + 1), 1),
              );
              tr.setMeta(markdownKey, true);
              return tr;
            }
          }
        }
      }

      // ===== PHASE E: paragraph → heading conversion =====
      // Anchored on `text-before-cursor` so subsequent typing in the
      // converted block doesn't keep re-firing the rule.
      if (parent.type === s.nodes.paragraph) {
        const before = text.slice(0, cursorOffset);
        for (const { prefix, nodeType, attrs } of blockSpecs) {
          if (before !== prefix) {
            continue;
          }
          const tr = newState.tr;
          tr.setBlockType(blockStart, blockStart, nodeType, attrs);
          if (delimMark) {
            tr.addMark(
              blockStart,
              blockStart + prefix.length,
              delimMark.create(),
            );
          }
          tr.setMeta(markdownKey, true);
          return tr;
        }
      }

      // ===== PHASE F: code block fence pair detection =====
      // Code blocks behave like a multi-line delimiter pair: typing the
      // closing ``` paragraph after a matching opening ``` paragraph
      // collapses everything between them (inclusive) into one codeBlock
      // node. Fences live inside as mdDelim text — Phase A reverts the
      // block if either fence is later broken.
      if (parent.type === s.nodes.paragraph && text === '```') {
        const grandparentDepth = $cursor.depth - 1;
        if (grandparentDepth >= 0) {
          const grandparent = $cursor.node(grandparentDepth);
          const closeIdx = $cursor.index(grandparentDepth);

          // Walk backward through siblings looking for the matching
          // opening fence. Bail on any non-paragraph sibling — fence
          // pairs shouldn't swallow headings or other structural blocks.
          let openIdx = -1;
          for (let i = closeIdx - 1; i >= 0; i--) {
            const sibling = grandparent.child(i);
            if (sibling.type !== s.nodes.paragraph) {
              break;
            }
            const siblingText = sibling.textBetween(
              0,
              sibling.content.size,
              undefined,
              '\ufffc',
            );
            if (siblingText === '```') {
              openIdx = i;
              break;
            }
          }

          if (openIdx >= 0) {
            const grandparentInside = $cursor.start(grandparentDepth);
            const positions: number[] = [];
            let cur = grandparentInside;
            grandparent.forEach((child) => {
              positions.push(cur);
              cur += child.nodeSize;
            });
            positions.push(cur);

            const fromPos = positions[openIdx];
            const toPos = positions[closeIdx + 1];

            const lines: string[] = ['```'];
            for (let i = openIdx + 1; i < closeIdx; i++) {
              const child = grandparent.child(i);
              lines.push(
                child.textBetween(0, child.content.size, undefined, '\ufffc'),
              );
            }
            lines.push('```');
            const codeText = lines.join('\n');

            const codeBlockNode = s.nodes.codeBlock.create(
              null,
              s.text(codeText),
            );

            const tr = newState.tr;
            tr.replaceWith(fromPos, toPos, codeBlockNode);

            if (delimMark) {
              const innerStart = fromPos + 1;
              tr.addMark(innerStart, innerStart + 3, delimMark.create());
              tr.addMark(
                innerStart + codeText.length - 3,
                innerStart + codeText.length,
                delimMark.create(),
              );
            }

            // Park the cursor in a paragraph AFTER the codeBlock — the
            // user just finished writing the code block and the natural
            // next thing is to continue prose. If nothing follows, we
            // append an empty paragraph for them to land in.
            const codeBlockEnd = fromPos + codeBlockNode.nodeSize;
            const $end = tr.doc.resolve(codeBlockEnd);
            if (!$end.nodeAfter) {
              tr.insert(codeBlockEnd, s.nodes.paragraph.create());
            }
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(codeBlockEnd + 1), 1),
            );
            tr.setMeta(markdownKey, true);
            return tr;
          }
        }
      }

      // ===== PHASE: inline reconciliation =====
      const tr = newState.tr;
      const ctx: ReconcileContext = {
        parent,
        blockStart,
        text,
        newDoc: newState.doc,
        delimMark,
        tr,
      };
      let modified = false;

      // Code first — claims ranges that subsequent emphasis specs must
      // skip when scanning for delimiters.
      const codePairs = codeMark ? findPairs(text, '`', []) : [];
      const codeRanges: Range[] = codePairs.map((p) => ({
        start: p.openStart,
        end: p.closeEnd,
      }));

      if (codeMark) {
        modified =
          reconcileInlineSpec(
            { delim: '`', markType: codeMark },
            codePairs,
            [],
            false,
            ctx,
          ) || modified;
      }

      for (const spec of emphasisSpecs) {
        const pairs = findPairs(text, spec.delim, codeRanges);
        modified =
          reconcileInlineSpec(spec, pairs, codeRanges, true, ctx) || modified;
      }

      if (modified) {
        tr.setMeta(markdownKey, true);
        return tr;
      }
      return null;
    },
  });
}
