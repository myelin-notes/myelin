import { Plus as PlusIcon, Trash2 as TrashIcon } from 'lucide-react';
import { createRoot } from 'react-dom/client';

type PdfChromeButtonKind = 'add' | 'delete';

interface PdfChromeButtonOptions {
  kind: PdfChromeButtonKind;
  onPress: () => void;
}

export interface PdfChromeButtonHandle {
  root: HTMLDivElement;
  sync: (params: { screenX: number; screenY: number; size: number }) => void;
  dispose: () => void;
}

export function createPdfChromeButton({
  kind,
  onPress,
}: PdfChromeButtonOptions): PdfChromeButtonHandle {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    transformOrigin: '0 0',
    pointerEvents: 'auto',
    visibility: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const reactRoot = createRoot(root);
  reactRoot.render(<PdfChromeButton kind={kind} onPress={onPress} />);

  return {
    root,
    sync: ({ screenX, screenY, size }) => {
      root.style.visibility = 'visible';
      root.style.transform = `translate(${screenX - size / 2}px, ${screenY - size / 2}px)`;
      root.style.width = `${size}px`;
      root.style.height = `${size}px`;
      root.style.borderRadius = 'var(--radius-lg)';
    },
    dispose: () => {
      reactRoot.unmount();
      root.remove();
    },
  };
}

function PdfChromeButton({
  kind,
  onPress,
}: {
  kind: PdfChromeButtonKind;
  onPress: () => void;
}) {
  const isAdd = kind === 'add';
  const Icon = isAdd ? PlusIcon : TrashIcon;
  const label = isAdd ? 'Add blank page' : 'Delete page';

  return (
    <button
      type="button"
      className={`pdf-chrome-button pdf-chrome-button--${kind}`}
      title={label}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPress();
      }}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        visibility: 'visible',
      }}
    >
      <Icon aria-hidden="true" strokeWidth={1.5} />
    </button>
  );
}
