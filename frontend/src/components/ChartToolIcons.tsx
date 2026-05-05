import type { SVGProps } from "react";

export type ChartToolIcon = (props: SVGProps<SVGSVGElement> & { size?: number | string }) => JSX.Element;

function IconFrame({
  children,
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function TvCursorIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 3l12 8-5.2 1.2L9 20 5 3Z" />
      <path d="M11.8 12.2 17 19" />
    </IconFrame>
  );
}

export function TvCrosshairIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M12 3v6" />
      <path d="M12 15v6" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
      <circle cx="12" cy="12" r="2.3" />
    </IconFrame>
  );
}

export function TvTrendLineIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 18 19 6" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
    </IconFrame>
  );
}

export function TvHorizontalLineIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M4 12h16" />
      <path d="M7 8h10" opacity="0.35" />
      <path d="M7 16h10" opacity="0.35" />
      <path d="M18 9v6" />
    </IconFrame>
  );
}

export function TvRectangleIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <rect height="11" rx="1.5" width="14" x="5" y="7" />
      <path d="M7 9h10" opacity="0.35" />
      <path d="M7 16h10" opacity="0.35" />
    </IconFrame>
  );
}

export function TvFibIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M6 19 18 5" />
      <path d="M5 6h14" />
      <path d="M5 10h14" opacity="0.72" />
      <path d="M5 14h14" opacity="0.72" />
      <path d="M5 18h14" />
      <circle cx="6" cy="19" r="1.4" />
      <circle cx="18" cy="5" r="1.4" />
    </IconFrame>
  );
}

export function TvMeasureIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 18 18 5" />
      <path d="m8 15 1.6 1.6" />
      <path d="m10.8 12.2 1.6 1.6" />
      <path d="m13.6 9.4 1.6 1.6" />
      <path d="M5 18h6" />
      <path d="M18 5v6" />
    </IconFrame>
  );
}

export function TvLongPositionIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 12h14" />
      <path d="M7 6h10" stroke="#22c55e" />
      <path d="M7 18h10" stroke="#fb7185" />
      <path d="M12 12V6" stroke="#22c55e" />
      <path d="M12 12v6" stroke="#fb7185" />
      <path d="m9.5 8.5 2.5-2.5 2.5 2.5" stroke="#22c55e" />
    </IconFrame>
  );
}

export function TvShortPositionIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 12h14" />
      <path d="M7 6h10" stroke="#fb7185" />
      <path d="M7 18h10" stroke="#22c55e" />
      <path d="M12 12V6" stroke="#fb7185" />
      <path d="M12 12v6" stroke="#22c55e" />
      <path d="m9.5 15.5 2.5 2.5 2.5-2.5" stroke="#22c55e" />
    </IconFrame>
  );
}

export function TvTextIcon(props: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <IconFrame {...props}>
      <path d="M5 6h14" />
      <path d="M12 6v12" />
      <path d="M9 18h6" />
      <path d="M6 9V6" />
      <path d="M18 9V6" />
    </IconFrame>
  );
}
