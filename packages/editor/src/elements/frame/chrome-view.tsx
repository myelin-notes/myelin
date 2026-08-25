import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { getMessages } from '../../i18n';
import { setStyleIfChanged } from '../../utils/style-cache';
import {
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  MENU_BUTTON_SIZE,
} from './chrome-layout';

export interface FrameChromeViewHandle {
  startTitleRename: () => void;
  /**
   * Written imperatively because these change every frame while zooming. Routing them as CSS custom
   * properties on the chrome root (an ancestor of the whole editor subtree) forced a full-subtree
   * style recalc per frame, since custom properties inherit.
   */
  syncHeaderGeometry: (params: {
    headerHeight: number;
    innerWidth: number;
    zoom: number;
  }) => void;
}

interface FrameChromeViewProps {
  kindLabel: string;
  fileName: string | null;
  contentSlot: HTMLDivElement;
  controlsSlot: HTMLDivElement;
  canRenameTitle: boolean;
  onTitleCommit: (title: string) => string | undefined;
  onOpenMenu: (anchor: DOMRect) => void;
}

export const FrameChromeView = forwardRef<
  FrameChromeViewHandle,
  FrameChromeViewProps
>(function FrameChromeView(
  {
    kindLabel,
    fileName,
    contentSlot,
    controlsSlot,
    canRenameTitle,
    onTitleCommit,
    onOpenMenu,
  },
  ref,
) {
  const strings = getMessages().canvas.frame;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const headerClipRef = useRef<HTMLDivElement>(null);
  const headerInnerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldFocusTitleInput = useRef(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(fileName ?? '');

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    surface.appendChild(contentSlot);
    return () => {
      if (contentSlot.parentElement === surface) {
        contentSlot.remove();
      }
    };
  }, [contentSlot]);

  useLayoutEffect(() => {
    if (!(isEditingTitle && shouldFocusTitleInput.current)) {
      return;
    }

    shouldFocusTitleInput.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditingTitle]);

  useImperativeHandle(
    ref,
    () => ({
      startTitleRename: () => {
        if (!canRenameTitle || isEditingTitle) {
          return;
        }
        shouldFocusTitleInput.current = true;
        setDraftTitle(fileName ?? '');
        setIsEditingTitle(true);
      },
      syncHeaderGeometry: ({ headerHeight, innerWidth, zoom }) => {
        const clip = headerClipRef.current;
        const inner = headerInnerRef.current;
        if (!clip || !inner) {
          return;
        }
        setStyleIfChanged(clip, 'height', `${headerHeight}px`);
        setStyleIfChanged(inner, 'width', `${innerWidth}px`);
        setStyleIfChanged(inner, 'transform', `scale(${zoom})`);
      },
    }),
    [canRenameTitle, fileName, isEditingTitle],
  );

  const commitTitleRename = () => {
    if (!isEditingTitle) {
      return;
    }
    setIsEditingTitle(false);
    const committed = onTitleCommit(draftTitle);
    if (typeof committed === 'string') {
      setDraftTitle(committed);
    }
  };

  const cancelTitleRename = () => {
    if (!isEditingTitle) {
      return;
    }
    setIsEditingTitle(false);
    setDraftTitle(fileName ?? '');
  };

  return (
    <>
      <div
        ref={surfaceRef}
        className="absolute inset-0 overflow-visible bg-card"
        style={{
          borderRadius: 'inherit',
          boxShadow:
            '0 0 0 1px rgb(var(--shadow-rgb-elevated) / 0.10), 0 1px 2px rgb(var(--shadow-rgb) / 0.06), 0 10px 20px -8px rgb(var(--shadow-rgb) / 0.10), 0 36px 72px -24px rgb(var(--shadow-rgb) / 0.22)',
          pointerEvents: 'none',
        }}
      >
        <div
          ref={headerClipRef}
          className="pointer-events-none absolute top-0 right-0 left-0 overflow-hidden"
          // Height is set imperatively via syncHeaderGeometry — keep it out of JSX so React re-renders don't
          // fight the imperative writes.
        >
          <div
            ref={headerInnerRef}
            className="pointer-events-none absolute top-0 left-0 flex items-center text-text-primary"
            style={{
              height: `${CHROME_HEADER_HEIGHT}px`,
              paddingLeft: `${CHROME_SIDE_PADDING}px`,
              paddingRight: `${CHROME_SIDE_PADDING}px`,
              gap: '14px',
              fontFamily: 'Hanken Grotesk, Arial, sans-serif',
              // width and transform set imperatively via syncHeaderGeometry
              transformOrigin: '0 0',
            }}
          >
            <div
              className="flex min-w-0 flex-1 flex-col justify-center"
              style={{ gap: '2px' }}
            >
              <span
                className="font-semibold text-[10px] text-text-muted uppercase leading-none"
                style={{ letterSpacing: '0.12em' }}
              >
                {kindLabel}
              </span>
              {isEditingTitle ? (
                <input
                  ref={inputRef}
                  type="text"
                  aria-label={strings.displayNameLabel}
                  data-page-frame-preserve-focus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.currentTarget.value)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitTitleRename();
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelTitleRename();
                    }
                  }}
                  onBlur={commitTitleRename}
                  className="w-full min-w-0 border-0 border-text-primary border-b-2 bg-transparent p-0 pb-0.5 font-medium text-[14px] text-text-primary leading-[1.2] outline-none"
                  style={{
                    borderRadius: 0,
                    fontFamily: 'Hanken Grotesk, Arial, sans-serif',
                    letterSpacing: '-0.005em',
                    pointerEvents: 'auto',
                  }}
                />
              ) : (
                fileName && (
                  <span
                    className="truncate font-medium text-[14px] text-text-primary leading-[1.2]"
                    style={{
                      fontFamily: 'Hanken Grotesk, Arial, sans-serif',
                      letterSpacing: '-0.005em',
                    }}
                  >
                    {fileName}
                  </span>
                )
              )}
            </div>
            <div
              aria-hidden="true"
              style={{
                width: `${MENU_BUTTON_SIZE}px`,
                height: `${MENU_BUTTON_SIZE}px`,
                flex: '0 0 auto',
              }}
            />
          </div>
        </div>
      </div>
      {createPortal(
        <button
          type="button"
          title={strings.menu}
          aria-label={strings.openMenu}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu(event.currentTarget.getBoundingClientRect());
          }}
          className="flex h-full w-full cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary focus-visible:bg-hover-tint focus-visible:text-text-primary focus-visible:outline-none"
          style={{ borderRadius: 'inherit' }}
        >
          <MenuIcon
            aria-hidden="true"
            className="h-[55%] w-[55%]"
            strokeWidth={1.5}
          />
        </button>,
        controlsSlot,
      )}
    </>
  );
});
