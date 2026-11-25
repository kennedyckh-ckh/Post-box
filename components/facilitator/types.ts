export interface FieldDef { key: string; label: string; required: boolean }
export interface Detail {
  session: {
    id: string; title: string; joinCode: string; joiningOpen: boolean; earlyJoin: boolean; status: "setup" | "live" | "archived";
    groupJoinMode: "choose" | "assigned"; submitPolicy: "any" | "representative"; participantFields: FieldDef[]; anonymiseDefault: boolean; myRole: "owner" | "co";
    aiCriteria: { preset: string; purpose: string; criteria: string; language: string; detail: "brief" | "standard" | "detailed" };
    reactionConfig: { enabled: boolean; scope: string; types: { key: string; label: string; icon?: string }[] };
    critiqueConfig: { enabled: boolean; scope: string; requireApproval: boolean; prompts: { key: string; label: string; enabled: boolean }[] };
  };
  groups: { id: string; name: string; seatCap: number | null; hasPin: boolean; activeCount: number; representativeId: string | null }[];
  stages: { id: string; position: number; title: string; enabled: boolean; visible: boolean; availability: "locked" | "open" | "closed"; submitMode?: "group" | "individual" }[];
  facilitators: { id: string; name: string; email: string; role: "owner" | "co" }[];
}
export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
