import Link from "next/link";
import { AppHeader } from "@/components/ui";

const STEPS = [
  { n: "1", title: "Create", text: "Set up a session, name the groups and shape each part with your own questions." },
  { n: "2", title: "Join", text: "Participants enter a short code. No account, no password." },
  { n: "3", title: "Work in groups", text: "Everyone writes their own contributions. The group hands its work in together." },
  { n: "4", title: "Share and reflect", text: "You choose what to share, anonymously if you wish, and the class responds." },
];

export default function Home() {
  const big = "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-6 py-3 text-base font-bold transition sm:w-auto";
  return (
    <>
      <AppHeader />
      <main id="main">
        <section className="relative overflow-hidden bg-gradient-to-r from-[#1e3a8a] via-[#3730a3] to-[#6d28d9] text-white">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
          <div aria-hidden="true" className="pointer-events-none absolute right-40 top-40 h-56 w-56 rounded-full bg-violet-300/20" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-blue-300/15" />
          <div className="relative mx-auto max-w-6xl px-4 pb-32 pt-12 sm:pb-40 sm:pt-20">
            <p className="mb-4 inline-block rounded-full border border-white/40 bg-white/10 px-4 py-1 text-sm font-semibold">Collaborative learning, led by you</p>
            <h1 className="max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">Think together.<br />Learn from every group.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-blue-50 sm:text-xl">Group Work helps facilitators run structured group activities for classes, workshops and professional learning, so every voice is heard and you decide what is shared.</p>
          </div>
        </section>

        <div className="relative mx-auto -mt-24 max-w-6xl px-4 sm:-mt-28">
          <div className="grid gap-6 md:grid-cols-2">
            <section aria-labelledby="p-h" className="rounded-2xl border border-line border-t-4 border-t-[#1d4ed8] bg-white p-7 shadow-[0_10px_30px_rgba(30,58,138,0.18)]">
              <h2 id="p-h" className="text-2xl font-bold text-brand-strong">I am a participant</h2>
              <p className="mb-6 mt-2 text-slate-800">Join with the code your facilitator gave you and work with your group.</p>
              <Link href="/join" className={`${big} bg-gradient-to-r from-[#1d4ed8] to-[#4338ca] text-white shadow-sm hover:from-[#1e3a8a] hover:to-[#3730a3]`}>Join a session</Link>
              <p className="mt-5 text-sm">Already joined on another device? <Link href="/recover" className="font-semibold text-brand-strong underline">Use your recovery code</Link></p>
            </section>
            <section aria-labelledby="f-h" className="rounded-2xl border border-line border-t-4 border-t-[#6d28d9] bg-white p-7 shadow-[0_10px_30px_rgba(76,29,149,0.18)]">
              <h2 id="f-h" className="text-2xl font-bold text-[#4c1d95]">I am a facilitator</h2>
              <p className="mb-6 mt-2 text-slate-800">Sign in to create sessions, follow each group's progress and decide what to share.</p>
              <Link href="/facilitator" className={`${big} bg-gradient-to-r from-[#5b21b6] to-[#6d28d9] text-white shadow-sm hover:from-[#4c1d95] hover:to-[#5b21b6]`}>Facilitator sign in</Link>
              <p className="mt-5 text-sm text-slate-700">Accounts are created by your administrator.</p>
            </section>
          </div>
        </div>

        <section aria-labelledby="how-h" className="mx-auto max-w-6xl px-4 pb-16 pt-16">
          <h2 id="how-h" className="mb-8 text-center text-3xl font-bold text-brand-strong">How it works</h2>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl border border-line bg-white p-6 shadow-[0_2px_10px_rgba(30,58,138,0.07)]">
                <span aria-hidden="true" className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#1d4ed8] to-[#6d28d9] text-lg font-bold text-white">{s.n}</span>
                <h3 className="mb-1 text-lg font-bold text-brand-strong"><span className="sr-only">Step {s.n}: </span>{s.title}</h3>
                <p className="text-slate-800">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-line bg-white/70 px-4 py-6 text-center text-sm text-slate-700">
        <Link href="/notice" className="font-semibold text-brand-strong underline">How your information is used</Link>
      </footer>
    </>
  );
}
