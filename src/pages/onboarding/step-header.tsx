export function StepHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <span className="text-[10px] text-text-muted uppercase tracking-widest">
        {eyebrow}
      </span>
      <h1 className="mt-2 font-extralight font-heading text-3xl text-text-primary tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-sm text-text-secondary leading-relaxed">
        {description}
      </p>
    </header>
  );
}
