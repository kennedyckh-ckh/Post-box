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
        <p className="mb-4">Enter the recovery code you were shown when you joined. It looks like <span className="font-mono">ABCD-EFGH-JKLM-NPQR</span>. Your name alone cannot be used to sign back in.</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit}>
          <TextField label="Recovery code" value={code} onChange={setCode} autoComplete="off" required />
          <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Recover my session"}</Button>
        </form>
        <p className="mt-4 text-sm">Lost the code? Ask your facilitator to issue a new one. <Link href="/" className="underline">Back</Link></p>
      </Card>
    </Shell>
  );
}
