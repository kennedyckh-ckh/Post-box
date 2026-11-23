"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errText } from "@/lib/client/api";
import { Shell, Card, Button, TextField, Alert } from "@/components/ui";

export default function RecoverPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("POST", "/recover", { recoveryCode: code });
      router.push("/session");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Get back to your work">
      <Card>
        <p className="mb-4">Enter your private recovery code. It looks like <span className="font-mono">ABCD-EFGH-JKLM-NPQR</span>. You can find it on your session page, under “Your recovery code”, on any device where you are still signed in. Your name alone cannot be used to sign back in.</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit}>
          <TextField label="Recovery code" value={code} onChange={setCode} autoComplete="off" required />
          <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Recover my session"}</Button>
        </form>
        <p className="mt-4 text-sm text-muted">Lost the code and no longer signed in anywhere? Ask your facilitator to issue a new one. <Link href="/" className="underline">Back</Link></p>
      </Card>
    </Shell>
  );
}
