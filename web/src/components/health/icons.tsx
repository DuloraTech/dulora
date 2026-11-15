// 健康模块图标（自包含，不依赖 components/ui/Icons.tsx）。
// 风格与应用图标一致：24 viewBox、stroke 1.75、round cap。
import type { SVGProps } from 'react';

export type HealthIconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, className = '', ...props }: HealthIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** 导航图标：心率脉搏 */
export function IconHeartPulse(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </Base>
  );
}

export function IconActivity(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Base>
  );
}

export function IconMoon(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Base>
  );
}

export function IconHeart(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </Base>
  );
}

/** 体重秤 */
export function IconScale(props: HealthIconProps) {
  return (
    <Base {...props}>
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M8 13a4 4 0 0 1 8 0" />
      <path d="m12 13 1.8-2.4" />
    </Base>
  );
}

/** 血氧滴 */
export function IconDroplet(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </Base>
  );
}

/** 压力表 */
export function IconGauge(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Base>
  );
}

export function IconZap(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Base>
  );
}

export function IconRefresh(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Base>
  );
}

export function IconQrCode(props: HealthIconProps) {
  return (
    <Base {...props}>
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h1" />
      <path d="M21 12v.01" />
      <path d="M12 21v-1" />
    </Base>
  );
}

export function IconChevronLeft(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="m15 18-6-6 6-6" />
    </Base>
  );
}

export function IconChevronRight(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="m9 18 6-6-6-6" />
    </Base>
  );
}

export function IconChevronDown(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

export function IconX(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Base>
  );
}

export function IconCheck(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Base>
  );
}

export function IconAlert(props: HealthIconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Base>
  );
}

export function IconLoader(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Base>
  );
}

export function IconLink(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </Base>
  );
}

export function IconUnlink(props: HealthIconProps) {
  return (
    <Base {...props}>
      <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="m5.17 11.75-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M8 2v3" />
      <path d="M2 8h3" />
      <path d="M16 19v3" />
      <path d="M19 16h3" />
    </Base>
  );
}