export const explorerGridCardClass =
  'group relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[1.1rem] bg-card/75 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-card hover:shadow-ambient';

export const explorerGridCardDragOverClass =
  'bg-card ring-2 ring-accent/35 shadow-ambient';

export const explorerGridMediaClass =
  'relative aspect-[16/10] w-full overflow-hidden bg-surface/80';

export const explorerGridBodyClass =
  'flex min-w-0 flex-1 flex-col gap-2 px-4 pt-3 pb-4 sm:px-5 sm:pb-5';

export const explorerGridTitleClass =
  'line-clamp-2 text-[15px] leading-5 text-text-primary transition-colors duration-200 group-hover:text-accent-dark';

export const explorerGridRenameInputClass =
  'w-full border-primary border-b-2 bg-transparent pb-1 font-normal text-sm text-text-primary outline-none';

export const explorerGridTagsClass =
  'mt-auto flex min-w-0 flex-wrap gap-1.5 pt-1';

export const explorerGridTagClass =
  'rounded-md bg-tag px-2 py-0.5 font-normal text-[10px] text-text-tag';

export const explorerGridTagOverflowClass =
  'self-center text-[10px] text-text-muted';

export const explorerGridFadeMask = {
  maskImage: 'linear-gradient(to bottom, black 74%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, black 74%, transparent 100%)',
};

export const explorerGridPlaceholderStyle = {
  backgroundImage:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 48%), radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
  backgroundPosition: '0 0, 0 0',
  backgroundSize: '100% 100%, 14px 14px',
};
