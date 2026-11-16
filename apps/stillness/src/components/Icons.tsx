import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function IconBack(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Lucide `panel-left`: a sidebar affordance, distinct from a More menu. */
export function IconPanelLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9l3 3-3 3M13 15h4" />
    </svg>
  );
}

export function IconFilePlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M12 12v5M9.5 14.5h5" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.2 3.2 5 3.2 8s-1 5.8-3.2 8c-2.2-2.2-3.2-5-3.2-8s1-5.8 3.2-8z" />
    </svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4l1.4 4.1L17.5 9.5l-4.1 1.4L12 15l-1.4-4.1L6.5 9.5l4.1-1.4z" />
      <path d="M18 15l.7 2.1 2.1.7-2.1.7L18 21l-.7-2.5-2.1-.7 2.1-.7z" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l8 4.5-8 4.5-8-4.5z" />
      <path d="M4 12.5l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
    </svg>
  );
}

export function IconWrench(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.5-.6-.6-2.5z" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 6.5h6l2 2h9v10a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5z" />
    </svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
    </svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function IconChecklist(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5" />
      <path d="M11 7h9M11 13h9M11 19h9" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </svg>
  );
}

export function IconInspector(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

export function IconServer(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4" width="17" height="6" rx="1.5" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11a8 8 0 1 0-1.5 5.5" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-5z" />
      <path d="M9.5 12l1.8 1.8 3.5-3.6" />
    </svg>
  );
}

export function IconCommand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zM15 6.5A2.5 2.5 0 1 1 17.5 9H15zM9 17.5A2.5 2.5 0 1 1 6.5 15H9zM15 17.5a2.5 2.5 0 1 0 2.5-2.5H15z" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function IconDot(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 8 })}>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5z" />
      <path d="M12 13v7.5" />
    </svg>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 12.5a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="M4.5 17l4.6-4.6 3.1 3.1 2.6-2.6 4.7 4.1" />
    </svg>
  );
}
