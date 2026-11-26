import type { ReactNode } from 'react'

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const I = (children: ReactNode) => <svg {...base}>{children}</svg>

export const IconHome = () => I(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>)
export const IconBook = () => I(<><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><path d="M4 19V5" /></>)
export const IconUpload = () => I(<><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" /></>)
export const IconCalc = () => I(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" /></>)
export const IconChart = () => I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>)
export const IconSettings = () => I(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></>)
export const IconUsers = () => I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 5.5" /></>)
export const IconDownload = () => I(<><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>)
export const IconPlus = () => I(<><path d="M12 5v14M5 12h14" /></>)
export const IconLogout = () => I(<><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>)
export const IconReceipt = () => I(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>)
export const IconBriefcase = () => I(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18" /></>)
export const IconWallet = () => I(<><path d="M3 7a2 2 0 012-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16.5" cy="13.5" r="1" /></>)
export const IconTrend = () => I(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>)
export const IconAlert = () => I(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></>)
