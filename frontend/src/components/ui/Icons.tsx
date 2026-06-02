import type { SVGProps } from "react";

interface IcProps extends SVGProps<SVGSVGElement> {
  size?: number;
  fill?: string;
}

function Ic({ size = 18, fill, children, ...p }: IcProps) {
  return (
    <svg
      className="nav-ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IcProps) => (
  <Ic {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Ic>
);
export const IconRecord = (p: IcProps) => (
  <Ic {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Ic>
);
export const IconSettings = (p: IcProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.76l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.73 1.13V21a2 2 0 1 1-4 0v-.09A1.6 1.6 0 0 0 6.7 19.4a1.6 1.6 0 0 0-1.76.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 2.6 14H2.5a2 2 0 1 1 0-4h.09A1.6 1.6 0 0 0 4.6 8.7a1.6 1.6 0 0 0-.32-1.76l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.4A1.6 1.6 0 0 0 11 2.6V2.5a2 2 0 1 1 4 0v.09A1.6 1.6 0 0 0 17.3 4.6a1.6 1.6 0 0 0 1.76-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 21.4 9v.4a1.6 1.6 0 0 0 1.1 1.6" />
  </Ic>
);
export const IconProfile = (p: IcProps) => (
  <Ic {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
  </Ic>
);
export const IconChevL = (p: IcProps) => (
  <Ic {...p}><path d="M15 6l-6 6 6 6" /></Ic>
);
export const IconChevR = (p: IcProps) => (
  <Ic {...p}><path d="M9 6l6 6-6 6" /></Ic>
);
export const IconChevD = (p: IcProps) => (
  <Ic {...p}><path d="M6 9l6 6 6-6" /></Ic>
);
export const IconPlus = (p: IcProps) => (
  <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>
);
export const IconX = (p: IcProps) => (
  <Ic {...p}><path d="M6 6l12 12M18 6l-12 12" /></Ic>
);
export const IconMenu = (p: IcProps) => (
  <Ic {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Ic>
);
export const IconArrowR = (p: IcProps) => (
  <Ic {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Ic>
);
export const IconLock = (p: IcProps) => (
  <Ic {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Ic>
);
export const IconLogout = (p: IcProps) => (
  <Ic {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Ic>
);
export const IconWallet = (p: IcProps) => (
  <Ic {...p}>
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M3 10h18M16 14h2" />
  </Ic>
);
export const IconTrend = (p: IcProps) => (
  <Ic {...p}><path d="M3 17l6-6 4 4 8-8M21 7v5M21 7h-5" /></Ic>
);
export const IconCheck = (p: IcProps) => (
  <Ic {...p}><path d="M5 12l5 5L20 6" /></Ic>
);
export const IconDownload = (p: IcProps) => (
  <Ic {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Ic>
);
