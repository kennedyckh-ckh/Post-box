import Link from "next/link";
import { Shell, Card } from "@/components/ui";

export default function Home() {
  const link = "mt-3 inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-semibold";
  return (
    <Shell title="Group Work">
      <p className="mb-8 text-lg text-slate-800">Collaborative work in small groups, led by a facilitator. Each person writes their own contributions, the group submits, and the facilitator decides what to share.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">I am a participant</h2>
          <p className="mt-1 text-slate-700">Join with the code your facilitator gave you.</p>
          <Link href="/join" className={`${link} bg-brand text-white hover:bg-brand-strong`}>Join a session</Link>
          <p className="mt-4 text-sm">
            Already joined on another device? <Link href="/recover" className="font-semibold underline">Use your recovery code</Link>
          </p>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold">I am a facilitator</h2>
          <p className="mt-1 text-slate-700">Sign in to create and run sessions.</p>
          <Link href="/facilitator" className={`${link} border border-brand bg-white text-brand-strong hover:bg-indigo-50`}>Facilitator sign in</Link>
        </Card>
      </div>
      <p className="mt-8 text-sm"><Link href="/notice" className="underline">How your information is used</Link></p>
    </Shell>
  );
}
