"use client";
import { useId } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";

/** Three people joined together: the mark of the product. Decorative, so hidden from screen readers. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="#ffffff" fillOpacity="0.16" />
      <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.85">
        <line x1="20" y1="11" x2="11" y2="27" />
        <line x1="20" y1="11" x2="29" y2="27" />
        <line x1="11" y1="27" x2="29" y2="27" />
      </g>
      <circle cx="20" cy="11" r="4.6" fill="#ffffff" />
      <circle cx="11" cy="27" r="4.6" fill="#c4b5fd" />
      <circle cx="29" cy="27" r="4.6" fill="#93c5fd" />
    </svg>
  );
}

export function HeaderButton({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-white/80 px-4 text-sm font-semibold text-white transition hover:bg-white/20 ${className}`} {...p}>
      {children}
    </button>
  );
}

export function AppHeader({ right, bare = false }: { right?: React.ReactNode; bare?: boolean }) {
  return (
    <header className={bare ? "text-white" : "bg-gradient-to-r from-[#1e3a8a] via-[#3730a3] to-[#6d28d9] text-white shadow-md"}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-3 rounded-lg text-xl font-bold tracking-tight text-white">
          <Logo />
          <span>Group Work</span>
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
        if (!confirm("Log off from this device?\n\nYour work stays saved. To come back, use your private recovery code (or ask your facilitator for a new one).")) return;
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
      <main id="main" className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-xl"} px-4 py-8 sm:py-10`}>
        {title && <h1 className="mb-6 text-3xl font-bold tracking-tight text-brand-strong">{title}</h1>}
        {children}
      </main>
    </>
  );
}

export function Card({ children, className = "", as: As = "section", label }: { children: React.ReactNode; className?: string; as?: "section" | "div"; label?: string }) {
  return (
    <As aria-label={label} className={`min-w-0 rounded-2xl border border-line bg-white p-5 shadow-[0_2px_10px_rgba(30,58,138,0.07)] ${As === "section" ? "border-t-4 border-t-accent" : ""} ${className}`}>
      {children}
    </As>
  );
}

export function Button({ children, variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const v = {
    primary: "bg-gradient-to-r from-[#1d4ed8] to-[#4338ca] text-white shadow-sm hover:from-[#1e3a8a] hover:to-[#3730a3]",
    secondary: "border border-brand bg-white text-brand-strong hover:bg-blue-50",
    danger: "bg-red-700 text-white hover:bg-red-800",
  }[variant];
  return (
    <button type="button" className={`${base} ${v} ${className}`} {...p}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  const hid = hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {children(id, hid)}
      {hint && (
        <p id={hid} className="mt-1 text-sm text-slate-700">
          {hint}
        </p>
      )}
    </div>
  );
}

export const inputCls = "w-full min-h-11 rounded-lg border border-slate-500 bg-white px-3 py-2 text-base";

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
    success: "border-green-700 bg-green-50 text-green-900",
    info: "border-blue-700 bg-blue-50 text-blue-900",
    warning: "border-amber-700 bg-amber-50 text-amber-900",
  }[kind];
  const prefix = { error: "Error: ", success: "Done: ", info: "Note: ", warning: "Warning: " }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border-l-4 p-3 text-sm ${style}`}>
      <strong>{prefix}</strong>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "amber" | "blue" | "red" }) {
  const t = { gray: "bg-slate-200 text-slate-900", green: "bg-green-100 text-green-900", amber: "bg-amber-100 text-amber-900", blue: "bg-violet-100 text-violet-900", red: "bg-red-100 text-red-900" }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
