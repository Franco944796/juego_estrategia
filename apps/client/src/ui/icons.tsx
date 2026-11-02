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

export const TroopIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21V8M12 3l3 6H9z" />
  </Svg>
);

export const SwordIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 3.5 20.5 3l-.5 6L9.5 19.5l-5-5zM6.5 12.5l5 5M3 21l3.5-3.5" />
  </Svg>
);

export const ArmorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m8 3 4 2 4-2 4 3-2 5v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8L4 6zM12 5v16" />
  </Svg>
);

export const HelmetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 18v-4a8 8 0 0 1 16 0v4zM9 18v-5h6v5M12 6V3" />
  </Svg>
);

export const CloakIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6l1.5 4L20 21H4L7.5 7zM9 3l3 4 3-4M12 7v14" />
  </Svg>
);

export const BootsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3h6v9l5 3a2 2 0 0 1 1 1.7V20H5l1-7zM5 17h15" />
  </Svg>
);

export const RingIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="15" r="6" />
    <path d="m9 5 3-3 3 3-3 3z" />
  </Svg>
);

export const AmuletIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3c0 5 2 7 5 8 3-1 5-3 5-8" />
    <path d="m12 11 3 4-3 5-3-5z" />
  </Svg>
);

export const ChestIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10a8 5 0 0 1 16 0v9H4zM4 12h16M11 12h2v3h-2z" />
  </Svg>
);

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
