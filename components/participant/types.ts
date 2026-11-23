export interface TableData { columns: string[]; rows: string[][] }
export interface Entry {
  id: string; authorName: string; mine: boolean; questionId: string | null; kind: "text" | "table"; body: string; tags: string[];
  table: TableData | null; attachment: { id: string; mime: string; bytes: number; name: string } | null; version: number; createdAt: number; updatedAt: number;
}
export interface StageDetail {
  stage: { id: string; title: string; instructions: string; tags: string[]; contributionTypes: string[]; availability: "open" | "closed"; canWrite: boolean; blockedReason: { code: string; message: string } | null };
  questions: { id: string; text: string; required: boolean; parentId: string | null }[];
  hiddenQuestions: number;
  resources: { id: string; kind: "link" | "file"; title: string; url: string | null; attachmentId: string | null; mime: string | null }[];
  reference: { stageId: string; title: string; source: "draft" | "submitted"; entries: Entry[]; synthesis: string | null }[];
  synthesis: { body: string; version: number };
  submitPolicy: string;
  submission: { status: "draft" | "submitted" | "reopened"; revision: number; submittedAt: number | null; submittedByName: string | null };
  groupName?: string;
}
export interface EntryList {
  etag: string; canWrite: boolean; availability: string; blockedReason: { code: string; message: string } | null; entries: Entry[]; synthesis: { body: string; version: number }; unchanged?: boolean;
  submission: { status: "draft" | "submitted" | "reopened"; revision: number; submittedAt: number | null; submittedByName: string | null };
  engagement: {
    reactions: { enabled: boolean; types: { key: string; label: string; icon?: string }[] };
    critique: { enabled: boolean; prompts: { key: string; label: string }[] };
    byEntry: Record<string, { reactions: { counts: Record<string, number>; mine: string[]; total: number }; comments: { id: string; author: string; mine: boolean; promptKey: string; body: string; status: string; createdAt: number }[] }>;
  };
}
export type SaveState = "idle" | "saving" | "saved" | "unsaved" | "offline" | "error";
