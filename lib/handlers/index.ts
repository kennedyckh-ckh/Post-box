import "./auth";
import "./admin";
import "./sessions";
import "./groups";
import "./participants";
import "./stages";
import "./workspace";
import "./attachments";
import "./submissions";
import "./lifecycle";
import "./audit";
import "./sharing";
import "./export";
import "./ai";
import { route } from "../router";
import { get } from "../db";

route("GET", "/health", () => {
  get("SELECT 1 AS ok");
  return { ok: true };
});

export { handle } from "../router";
