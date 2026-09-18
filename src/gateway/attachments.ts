/**
 * Safe intake of chat attachments into the workspace sandbox (.forge/inbox).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AttachmentMeta } from "./types.js";

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MiB per file (base64 payload)

export interface IncomingAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64?: string;
  /** Workspace-relative path already inside the project (no copy). */
  workspacePath?: string;
}

function safeFileName(name: string): string {
  const base = basename(name).replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
  return base || "attachment";
}

/**
 * Persist small uploads under `.forge/inbox/` and return metadata for the message.
 * Rejects oversized payloads. Workspace-relative path refs are recorded without copy.
 */
export function intakeAttachments(
  workspacePath: string,
  incoming: IncomingAttachment[],
): AttachmentMeta[] {
  if (incoming.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
  }
  const inbox = join(workspacePath, ".forge", "inbox");
  mkdirSync(inbox, { recursive: true });

  const out: AttachmentMeta[] = [];
  for (const item of incoming) {
    const id = randomUUID();
    const name = safeFileName(item.name);
    if (item.workspacePath) {
      const rel = item.workspacePath.replace(/\\/g, "/").replace(/^\/+/, "");
      if (rel.includes("..") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
        throw new Error(`Invalid workspace path for attachment: ${item.name}`);
      }
      out.push({
        id,
        name,
        mimeType: item.mimeType || "application/octet-stream",
        sizeBytes: item.sizeBytes,
        storedPath: rel,
      });
      continue;
    }
    if (!item.dataBase64) {
      throw new Error(`Attachment ${name} has no data`);
    }
    const buf = Buffer.from(item.dataBase64, "base64");
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment ${name} is too large (max ${MAX_ATTACHMENT_BYTES} bytes)`,
      );
    }
    if (item.sizeBytes > 0 && Math.abs(item.sizeBytes - buf.byteLength) > 64) {
      // size hint mismatch — trust decoded length
    }
    const storedName = `${id.slice(0, 8)}-${name}`;
    const abs = join(inbox, storedName);
    writeFileSync(abs, buf);
    out.push({
      id,
      name,
      mimeType: item.mimeType || "application/octet-stream",
      sizeBytes: buf.byteLength,
      storedPath: `.forge/inbox/${storedName}`.replace(/\\/g, "/"),
    });
  }
  return out;
}

/** Append human-readable attachment refs to the user message text. */
export function formatAttachmentsForPrompt(
  text: string,
  attachments: AttachmentMeta[],
): string {
  if (attachments.length === 0) return text;
  const lines = attachments.map((a) => {
    const path = a.storedPath ?? a.name;
    const kind = a.mimeType.startsWith("image/")
      ? "image"
      : a.mimeType === "inode/directory" || path.endsWith("/")
        ? "folder"
        : "file";
    return `- (${kind}) ${a.name} → \`${path}\``;
  });
  const block = ["Attachments:", ...lines].join("\n");
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}
