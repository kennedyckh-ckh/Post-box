/** Small line icons for reaction types. Decorative: the reaction's label is always shown or announced beside it. */
export const ICON_CHOICES: { key: string; label: string }[] = [
  { key: "thumbs", label: "Thumbs up" },
  { key: "heart", label: "Heart" },
  { key: "star", label: "Star" },
  { key: "idea", label: "Light bulb" },
  { key: "clap", label: "Clapping hands" },
  { key: "smile", label: "Smile" },
  { key: "question", label: "Question mark" },
  { key: "check", label: "Tick" },
  { key: "none", label: "No icon" },
];

export function ReactionIcon({ icon, filled = false, size = 18 }: { icon?: string; filled?: boolean; size?: number }) {
  if (!icon || icon === "none") return null;
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "shrink-0" };
  const fill = filled ? "currentColor" : "none";
  switch (icon) {
    case "heart":
      return <svg {...common} fill={fill} stroke="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.4 1.1 4.9 3 1.5-1.9 2.9-3 4.9-3 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" /></svg>;
    case "thumbs":
      return <svg {...common} fill={fill} stroke="currentColor"><path d="M7.5 10.5v9.5H4.2a1.2 1.2 0 0 1-1.2-1.2v-7.1c0-.7.5-1.2 1.2-1.2h3.3z" /><path d="M7.5 10.5 11.3 3c1.6 0 2.7 1.2 2.7 2.8v3.4h5.1c1.3 0 2.2 1.2 2 2.4l-1.3 6.9A2 2 0 0 1 17.8 20H7.5" /></svg>;
    case "star":
      return <svg {...common} fill={fill} stroke="currentColor"><path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
    case "idea":
      return <svg {...common} fill="none" stroke="currentColor"><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill={filled ? "currentColor" : "none"} /></svg>;
    case "clap":
      return <svg {...common} fill="none" stroke="currentColor"><path d="M8.5 13 5 9.5a1.4 1.4 0 0 1 2-2l4.3 4.3" /><path d="m7 7.5-.7-.7a1.4 1.4 0 0 1 2-2l5.6 5.6" /><path d="m10.7 6.6-.3-.3a1.4 1.4 0 0 1 2-2l5.2 5.2c2.5 2.5 2.5 6.5 0 9a6.3 6.3 0 0 1-9 0l-3.5-3.5a1.4 1.4 0 0 1 2-2L9 15" fill={filled ? "currentColor" : "none"} /><path d="M17 2.5 16.3 4M20.5 5l-1.4.8" /></svg>;
    case "smile":
      return <svg {...common} fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" fill={filled ? "currentColor" : "none"} /><path d="M8.5 14.2a4.3 4.3 0 0 0 7 0" stroke={filled ? "var(--surface, #fff)" : "currentColor"} /><path d="M9 9.5h.01M15 9.5h.01" stroke={filled ? "var(--surface, #fff)" : "currentColor"} strokeWidth="2.6" /></svg>;
    case "question":
      return <svg {...common} fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" fill={filled ? "currentColor" : "none"} /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" stroke={filled ? "var(--surface, #fff)" : "currentColor"} /></svg>;
    case "check":
      return <svg {...common} fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" fill={filled ? "currentColor" : "none"} /><path d="m8 12.3 2.7 2.7L16.2 9.5" stroke={filled ? "var(--surface, #fff)" : "currentColor"} /></svg>;
    default:
      return null;
  }
}
