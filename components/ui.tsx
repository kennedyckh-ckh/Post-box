"use client";
import { useId } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";

/** Three people joined together: the mark of the product. Decorative, so hidden from screen readers. */
export function Logo({ size = 32, tone = "brand" }: { size?: number; tone?: "brand" | "light" }) {
  const tile = tone === "brand" ? "var(--brand-strong)" : "#ffffff";
  const tileOpacity = tone === "brand" ? 1 : 0.14;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="10" fill={tile} fillOpacity={tileOpacity} />
      <g stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7">
        <line x1="20" y1="11.5" x2="11.5" y2="27" />
        <line x1="20" y1="11.5" x2="28.5" y2="27" />
        <line x1="11.5" y1="27" x2="28.5" y2="27" />
      </g>
      <circle cx="20" cy="11.5" r="4.4" fill="#ffffff" />
      <circle cx="11.5" cy="27" r="4.4" fill="#e8b384" />
      <circle cx="28.5" cy="27" r="4.4" fill="#9fd0cb" />
    </svg>
  );
}

export function HeaderButton({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-semibold text-foreground transition hover:border-brand hover:text-brand-strong ${className}`} {...p}>
      {children}
    </button>
  );
}

export function AppHeader({ right, bare = false }: { right?: React.ReactNode; bare?: boolean }) {
  return (
    <header className={bare ? "" : "sticky top-0 z-30 border-b border-line bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg text-foreground">
          <Logo />
          <span className="font-display text-[1.2rem] font-semibold tracking-tight">Group Work</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">{right}</div>
      </div>
    </header>
  );
}

/** For participants. Logging off clears this device's sign-in; the private recovery code is how to come back. */
export function LogoffButton() {
  return (
    <HeaderButton
      onClick={async () => {
        if (!confirm("Log off from this device?\n\nYour work stays saved. To come back, you need your private recovery code. If you have not noted it yet, press Cancel and open “Your recovery code” on your session page first.")) return;
        await api("POST", "/leave", {}).catch(() => {});
        window.location.href = "/";
      }}
    >
      Log off
    </HeaderButton>
  );
}

export function SignOutButton() {
  return (
    <HeaderButton
      onClick={async () => {
        await api("POST", "/auth/logout", {}).catch(() => {});
        window.location.href = "/facilitator";
      }}
    >
      Sign out
    </HeaderButton>
  );
}

export function Shell({ children, title, wide, right }: { children: React.ReactNode; title?: string; wide?: boolean; right?: React.ReactNode }) {
  return (
    <>
      <AppHeader right={right} />
      <main id="main" className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-xl"} px-4 py-8 sm:px-6 sm:py-12`}>
        {title && <h1 className="mb-6 text-3xl text-ink sm:text-[2.1rem]">{title}</h1>}
        {children}
      </main>
    </>
  );
}

export function Card({ children, className = "", as: As = "section", label }: { children: React.ReactNode; className?: string; as?: "section" | "div"; label?: string }) {
  return (
    <As aria-label={label} className={`min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,29,36,0.04),0_8px_24px_-12px_rgba(15,29,36,0.10)] sm:p-6 ${className}`}>
      {children}
    </As>
  );
}

export function Button({ children, variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const base = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const v = {
    primary: "bg-brand-strong text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(15,29,36,0.25)] hover:bg-ink",
    secondary: "border border-line-strong bg-surface text-brand-strong hover:border-brand hover:bg-brand-soft",
    danger: "bg-red-700 text-white hover:bg-red-800",
    ghost: "text-brand-strong hover:bg-brand-soft",
  }[variant];
  return (
    <button type="button" className={`${base} ${v} ${className}`} {...p}>
      {children}
    </button>
  );
}

/** A link that looks like a secondary button. */
export const linkButtonCls = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-brand-strong transition hover:border-brand hover:bg-brand-soft";

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  const hid = hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-foreground">
        {label}
      </label>
      {children(id, hid)}
      {hint && (
        <p id={hid} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export const inputCls = "w-full min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-foreground shadow-[inset_0_1px_2px_rgba(15,29,36,0.04)] transition placeholder:text-muted/70 hover:border-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function TextField(p: { label: string; value: string; onChange: (v: string) => void; hint?: string; type?: string; autoComplete?: string; maxLength?: number; required?: boolean }) {
  return (
    <Field label={p.label + (p.required ? " (required)" : "")} hint={p.hint}>
      {(id, d) => (
        <input id={id} aria-describedby={d} className={inputCls} type={p.type || "text"} value={p.value} autoComplete={p.autoComplete} maxLength={p.maxLength} required={p.required} onChange={(e) => p.onChange(e.target.value)} />
      )}
    </Field>
  );
}

/** Errors and confirmations are announced to screen readers; they never rely on colour alone. */
export function Alert({ kind, children }: { kind: "error" | "success" | "info" | "warning"; children: React.ReactNode }) {
  const style = {
    error: "border-red-700 bg-red-50 text-red-900",
    success: "border-emerald-700 bg-emerald-50 text-emerald-950",
    info: "border-brand bg-brand-soft text-brand-strong",
    warning: "border-amber-700 bg-amber-50 text-amber-950",
  }[kind];
  const prefix = { error: "Error: ", success: "Done: ", info: "Note: ", warning: "Warning: " }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border-l-4 px-4 py-3 text-sm ${style}`}>
      <strong>{prefix}</strong>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "amber" | "blue" | "red" }) {
  const t = {
    gray: "bg-[#eeebe4] text-[#3d4650] ring-[#ddd7cb]",
    green: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    blue: "bg-brand-soft text-brand-strong ring-[#c7dcda]",
    red: "bg-red-50 text-red-900 ring-red-200",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${t}`}>{children}</span>;
}

/** Small uppercase label used above headings. */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent ${className}`}>{children}</p>;
}
