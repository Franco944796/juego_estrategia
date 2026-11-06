import type { ReactNode } from 'react';

/**
 * One gem per kind of figure, the same everywhere: gold is topaz, troops ruby, defense sapphire,
 * Dominion amethyst and experience emerald.
 */
export type GemKind = 'topaz' | 'ruby' | 'sapphire' | 'amethyst' | 'emerald';

export function Gem({
  kind,
  small = false,
  children,
}: {
  kind: GemKind;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`gem gem-${kind}${small ? ' gem-sm' : ''}`} aria-hidden="true">
      {children}
    </span>
  );
}
