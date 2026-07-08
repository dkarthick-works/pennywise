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
export const IconCreditCard = (p: IcProps) => (
  <Ic {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20M6 15h4" />
  </Ic>
);
export const IconInsights = (p: IcProps) => (
  <Ic {...p}>
    <path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
    <path d="M9 12l2 2 4-4" />
  </Ic>
);
export const IconShield = (p: IcProps) => (
  <Ic {...p}>
    <path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
    <path d="M9 12l2 2 4-4" />
  </Ic>
);
export const IconEye = (p: IcProps) => (
  <Ic {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Ic>
);
export const IconEyeOff = (p: IcProps) => (
  <Ic {...p}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M1 1l22 22" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
  </Ic>
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
export const IconExport = (p: IcProps) => (
  <Ic {...p}>
    <path d="M14 3h5v5" />
    <path d="M10 14L19 5" />
    <rect x="4" y="7" width="12" height="14" rx="2" />
    <path d="M8 13h4M8 17h5" />
  </Ic>
);
export const IconCategories = (p: IcProps) => (
  <Ic {...p}>
    <path d="M4 7h6M4 12h6M4 17h6" />
    <path d="M14 7l6 3-6 3V7z" />
  </Ic>
);
