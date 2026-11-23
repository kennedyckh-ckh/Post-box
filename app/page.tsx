import Link from "next/link";
import { AppHeader, Logo } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Create", text: "Set up a session, name the groups and shape each part with your own questions." },
  { n: "02", title: "Join", text: "Participants enter a short code. No account, no password." },
  { n: "03", title: "Work in groups", text: "Everyone writes their own contributions. The group hands its work in together." },
  { n: "04", title: "Share and reflect", text: "You choose what to share, anonymously if you wish, and the room responds." },
];

const PRINCIPLES = [
  { title: "Individual authorship", text: "Every contribution stays attributed to the person who wrote it, inside the group's shared space." },
  { title: "Group submission", text: "A group hands its work in together. The submitted version is kept, even after a reopen." },
  { title: "Facilitator release", text: "Parts and guiding questions appear only when you open or reveal them, one click at a time." },
  { title: "Deliberate sharing", text: "Nothing is public by default. You choose what the class and the projector see, and how it is labelled." },
];

/** Decorative product sketch for the cover. Purely visual, so hidden from assistive technology. */
function ProductSketch() {
  const groups = [
    { name: "Group A", state: "Submitted", tone: "bg-emerald-50 text-emerald-900 ring-emerald-200", lines: [92, 76, 60] },
    { name: "Group B", state: "Working", tone: "bg-amber-50 text-amber-900 ring-amber-200", lines: [84, 58] },
    { name: "Group C", state: "Working", tone: "bg-amber-50 text-amber-900 ring-amber-200", lines: [70, 88, 42] },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[540px] select-none">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-[#dcebe9] via-transparent to-[#f3e2cf] opacity-80 blur-2xl" />
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_24px_60px_-24px_rgba(15,29,36,0.35)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Part 2 of 3 · Open</p>
            <p className="font-display text-lg font-semibold text-ink">Interpreting the evidence</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">1 of 3 submitted</span>
        </div>
        <ol className="mb-4 space-y-2 rounded-xl bg-surface-2 p-3 text-[13px] leading-snug text-foreground ring-1 ring-line">
          <li className="flex gap-2"><span className="font-semibold text-brand">1.</span>What pattern do you notice in the results?</li>
          <li className="flex gap-2"><span className="font-semibold text-brand">2.</span>Which observation best supports your claim?</li>
          <li className="flex items-center gap-2 text-muted"><span className="font-semibold">3.</span><span className="h-2 w-40 rounded bg-line" /><span className="ml-auto rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px]">Reveal next</span></li>
        </ol>
        <div className="grid grid-cols-3 gap-2.5">
          {groups.map((g) => (
            <div key={g.name} className="rounded-xl border border-line p-2.5">
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className="text-xs font-semibold text-ink">{g.name}</span>
              </div>
              <span className={`mb-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${g.tone}`}>{g.state}</span>
              <div className="space-y-1.5">
                {g.lines.map((w, i) => <div key={i} className="h-1.5 rounded bg-[#e7e2d8]" style={{ width: `${w}%` }} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -bottom-8 -left-4 hidden w-56 rotate-[-2deg] rounded-xl border border-line bg-surface p-3 shadow-[0_18px_40px_-20px_rgba(15,29,36,0.4)] sm:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">On the projector</p>
        <p className="mt-1 font-display text-sm font-semibold text-ink">Sample Response 2</p>
        <p className="mt-1 text-xs leading-snug text-muted">“The rate rose until 40 °C, then fell sharply, so…”</p>
      </div>
      <div className="absolute -bottom-6 -right-3 hidden rotate-[3deg] rounded-xl bg-ink px-3 py-2 text-white shadow-lg sm:block">
        <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">Join code</p>
        <p className="font-mono text-base font-bold tracking-[0.2em]">K7QM4R</p>
      </div>
    </div>
  );
}

export default function Home() {
  const big = "inline-flex min-h-12 items-center justify-center rounded-xl px-6 py-3 text-base font-semibold transition";
  return (
    <>
      <AppHeader right={<Link href="/facilitator" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-strong hover:bg-brand-soft">Facilitator sign in</Link>} />
      <main id="main">
        <section className="relative overflow-hidden border-b border-line">
          <div aria-hidden="true" className="paper-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
            <div className="fade-up">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/80 px-3 py-1 text-sm font-medium text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />Collaborative learning, led by you
              </p>
              <h1 className="text-[2.6rem] leading-[1.05] text-ink sm:text-6xl lg:text-[4.1rem]">
                Think together.<br /><span className="italic text-brand">Learn from every group.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Group Work helps facilitators run structured group activities for classes, workshops and professional learning, so every voice is heard and you decide what is shared.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/join" className={`${big} bg-brand-strong text-white shadow-[0_10px_24px_-10px_rgba(18,63,69,0.8)] hover:bg-ink`}>Join a session</Link>
                <Link href="/facilitator" className={`${big} border border-line-strong bg-surface text-brand-strong hover:border-brand hover:bg-brand-soft`}>I am a facilitator</Link>
              </div>
              <p className="mt-5 text-sm text-muted">Already joined on another device? <Link href="/recover" className="font-semibold text-brand-strong underline">Use your recovery code</Link></p>
            </div>
            <ProductSketch />
          </div>
        </section>

        <section aria-labelledby="roles-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="roles-h" className="sr-only">Who it is for</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">Participants</p>
              <h3 className="font-display text-2xl font-semibold text-ink">Join with a code, work with your group</h3>
              <ul className="mt-4 space-y-2 text-foreground">
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />No account or password: just the code your facilitator gives you.</li>
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />Write your own entries, add tables and pictures, see your group's work live.</li>
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />Find your private recovery code any time on your session page.</li>
              </ul>
              <Link href="/join" className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-strong underline">Join a session <span aria-hidden="true">→</span></Link>
            </div>
            <div className="rounded-2xl border border-ink bg-ink p-8 text-white">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#e8b384]">Facilitators</p>
              <h3 className="font-display text-2xl font-semibold">Run the room, from setup to the projector</h3>
              <ul className="mt-4 space-y-2 text-white/85">
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9fd0cb]" />Choose how many guiding questions each part has, and reveal them one click at a time.</li>
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9fd0cb]" />Follow every group's progress and open the next part when the room is ready.</li>
                <li className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9fd0cb]" />Put the join code, questions, progress and chosen work on a full-screen projector view.</li>
              </ul>
              <Link href="/facilitator" className="mt-6 inline-flex items-center gap-1 font-semibold text-white underline">Facilitator sign in <span aria-hidden="true">→</span></Link>
              <p className="mt-2 text-sm text-white/60">Accounts are created by your administrator.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="how-h" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mb-12 max-w-2xl">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">How it works</p>
              <h2 id="how-h" className="text-3xl text-ink sm:text-4xl">Four steps, from a blank session to a shared discussion</h2>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="bg-surface p-7">
                  <span aria-hidden="true" className="font-display text-4xl font-semibold text-brand/30">{s.n}</span>
                  <h3 className="mb-1.5 mt-4 text-lg font-semibold text-ink"><span className="sr-only">Step {Number(s.n)}: </span>{s.title}</h3>
                  <p className="text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="pr-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">Designed with care</p>
              <h2 id="pr-h" className="text-3xl text-ink sm:text-4xl">Four things kept separate, on purpose</h2>
              <p className="mt-4 text-muted">Who wrote something, a group handing work in, a part being available and what others can see are independent decisions. That keeps authorship clear and puts you in charge of every release.</p>
            </div>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="border-t border-line-strong pt-5">
                  <dt className="font-display text-xl font-semibold text-ink">{p.title}</dt>
                  <dd className="mt-2 text-muted">{p.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
          <span className="flex items-center gap-2"><Logo size={22} /> Group Work</span>
          <Link href="/notice" className="font-semibold text-brand-strong underline">How your information is used</Link>
        </div>
      </footer>
    </>
  );
}
