"use client";
import { useId } from "react";

export function Shell({ children, title, wide }: { children: React.ReactNode; title?: string; wide?: boolean }) {
  return (
    <main id="main" className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-xl"} px-4 py-8 sm:py-12`}>
      {title && <h1 className="mb-6 text-3xl font-bold tracking-tight text-brand-strong">{title}</h1>}
      {children}
    </main>
  );
}

export function Card({ children, className = "", as: As = "section", label }: { children: React.ReactNode; className?: string; as?: "section" | "div"; label?: string }) {
  return (
    <As aria-label={label} className={`min-w-0 rounded-xl border border-line bg-white p-5 shadow-sm ${className}`}>
      {children}
    </As>
  );
}

export function Button({ children, variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const base = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const v = {
    primary: "bg-brand text-white hover:bg-brand-strong",
    secondary: "border border-brand bg-white text-brand-strong hover:bg-indigo-50",
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
  const t = { gray: "bg-slate-200 text-slate-900", green: "bg-green-100 text-green-900", amber: "bg-amber-100 text-amber-900", blue: "bg-indigo-100 text-indigo-900", red: "bg-red-100 text-red-900" }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
