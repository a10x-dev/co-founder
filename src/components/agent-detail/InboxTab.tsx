import { useState } from "react";
import type { Agent } from "@/types";
import { sendMessageToAgent, readTextFile } from "@/lib/api";

export interface InboxTabProps {
  agent: Agent;
  inboxContent: string;
  setInboxContent: (c: string) => void;
}

export default function InboxTab({ agent, inboxContent, setInboxContent }: InboxTabProps) {
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setMessageSending(true);
    try {
      await sendMessageToAgent(agent.id, messageText.trim());
      setMessageText("");
      readTextFile(agent.id, `${agent.workspace}/.founder/INBOX.md`).then(setInboxContent).catch(() => {});
    } finally {
      setMessageSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Inbox</h2>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        Messages are delivered on the next check-in.
      </p>
      <div className="flex gap-2">
        <input
          type="text" value={messageText} onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          placeholder="Type a message for your co-founder..."
          className="flex-1 h-10 px-3 rounded-lg text-[14px]"
          style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
        />
        <button onClick={handleSendMessage} disabled={messageSending || !messageText.trim()}
          className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}>
          {messageSending ? "Sending..." : "Send"}
        </button>
      </div>
      {inboxContent && inboxContent.includes("---") && (
        <div className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <h3 className="text-[15px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>Pending messages</h3>
          <pre className="text-[13px] font-mono whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{inboxContent}</pre>
        </div>
      )}
    </div>
  );
}
