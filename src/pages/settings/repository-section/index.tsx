import { useMessages } from '@/lib/i18n';
import { RepositorySetup } from './setup';

export function RepositorySection() {
  const strings = useMessages();

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.repository.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.repository.eyebrow}
        </span>
      </div>

      <RepositorySetup />
    </div>
  );
}
