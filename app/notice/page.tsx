import Link from "next/link";
import { Shell, Card } from "@/components/ui";

export const metadata = { title: "How your information is used" };

/** Plain-language participant notice. It describes what this app really does; it is not a legal opinion. */
export default function NoticePage() {
  const h = "mb-1 mt-5 text-xl font-semibold first:mt-0";
  return (
    <Shell title="How your information is used">
      <Card>
        <h2 className={h}>What is collected</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>The name you type, and any extra details your facilitator asks for (for example Class or Class Number). Two people can use the same name; each person gets a private identity.</li>
          <li>Your group, and everything you write or add: text, tables and pictures, with the time and your name. Location data inside photos is removed when you upload them.</li>
          <li>Your reactions and responses to other people's work.</li>
          <li>A sign-in cookie on your device that keeps you signed in. Your internet address is used for a short time (up to a day) only to slow down people who guess codes.</li>
        </ul>

        <h2 className={h}>Who can see what</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li><strong>Your group</strong> sees your entries with your name.</li>
          <li><strong>The facilitators of this session</strong> see everything, with names.</li>
          <li><strong>Other groups</strong> see nothing of yours unless your facilitator chooses to share it. Shared work is normally shown without names (for example “Sample Response 3”), or with only a group name. The words or pictures themselves could still identify you, so think before you write.</li>
          <li>The facilitator may show chosen work on a projector for the room.</li>
          <li>The person who runs this server can technically reach the stored data. The platform does not give that access to other facilitators.</li>
        </ul>

        <h2 className="mb-1 mt-5 text-xl font-semibold">When content may be sent to an AI service</h2>
        <p>Only if your facilitator turns on the optional AI analysis, and only when they press the button. The selected work is sent <strong>without names, class details or group names</strong> (people appear as Entry 1, Entry 2 and groups as Group A, B). Pictures and files are not sent. If the AI is in “demo” mode, nothing leaves the server. Your facilitator reads and edits any AI draft before anyone else sees it. AI can be wrong and is never used to grade you or to make decisions about you.</p>

        <h2 className={h}>How long it is kept</h2>
        <p>Your work is kept until your facilitator deletes the session. Deleting a session removes its records and uploaded files from the app. Copies in backups made earlier may remain until those backups expire. An archived session is only read-only, not deleted.</p>

        <h2 className={h}>Getting back in, and leaving</h2>
        <p>You are shown a private recovery code when you join. It is the only way to return from another device without help. If you lose it, ask your facilitator. If a facilitator removes you from a session, you lose access but your earlier contributions stay with your group's record.</p>

        <h2 className={h}>What this notice is not</h2>
        <p>It explains how this app works. It has not been checked against any law or institutional policy, and your organisation may need to add its own notice.</p>
        <p className="mt-6"><Link href="/" className="font-semibold underline">Back to the start</Link></p>
      </Card>
    </Shell>
  );
}
