import { type BlockStyle, BlockTypeDef } from './block-type-def';

export class ListItemBlock extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '400 16px "Inter", sans-serif',
    size: 16,
    color: '#191c1e',
    indent: 24,
    css: { position: 'relative' },
  };
  get markdownTrigger() {
    return /^- $/;
  }
  get continuesOnEnter() {
    return true;
  }

  createDecoration(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.contentEditable = 'false';
    Object.assign(bullet.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '24px',
      height: '1.5em',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    });
    bullet.innerHTML =
      '<svg width="5" height="5"><circle cx="2.5" cy="2.5" r="2.5" fill="#191c1e"/></svg>';
    return bullet;
  }
}
