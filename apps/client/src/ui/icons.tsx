import type { TroopType } from '@si/engine';
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CoinIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3" />
  </Svg>
);

export const CrownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 18h16l1-10-5 4-4-6-4 6-5-4z" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />
  </Svg>
);

export const MarchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17c4-1 6-5 8-10M12 7l-3 1M12 7l1 3M14 19c2-2 4-3 6-3" />
  </Svg>
);

export const ScrollIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4h11v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-1h11" />
    <path d="M7 4a2 2 0 0 0-2 2v11M10 9h5M10 13h5" />
  </Svg>
);

export const TrophyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" />
  </Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9h8M8 12h5" />
  </Svg>
);

export const LevelIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 14l6-6 6 6M6 19l6-6 6 6" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
  </Svg>
);

export function TroopIcon({ type, ...p }: IconProps & { type: TroopType }) {
  if (type === 'LANCER') {
    return (
      <Svg {...p}>
        <path d="M12 21V8M12 3l3 6H9z" />
      </Svg>
    );
  }
  if (type === 'ARCHER') {
    return (
      <Svg {...p}>
        <path d="M8 3a12 12 0 0 1 0 18M8 3v18M4 12h14M15 9l3 3-3 3" />
      </Svg>
    );
  }
  return (
    <Svg {...p}>
      <path d="M2 10c4-4 7-2 10 6 3-8 6-10 10-6" />
    </Svg>
  );
}

/** Arrow pointing where the wind blows: direction 0 is north, each step 45° clockwise. */
export function WindArrow({ dir, size = 18 }: { dir: number; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: `rotate(${dir * 45}deg)` }}
    >
      <path d="M12 3l5 7h-3.5v11h-3V10H7z" fill="currentColor" />
    </svg>
  );
}
