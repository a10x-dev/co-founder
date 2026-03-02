import { useState } from "react";
import { friendlyError } from "@/lib/friendlyErrors";

interface FriendlyErrorProps {
  error: string;
}

export default function FriendlyError({ error }: FriendlyErrorProps) {
  const [showRaw, setShowRaw] = useState(false);
  const { friendly, raw } = friendlyError(error);
  const hasDetail = friendly !== raw && raw !== friendly;

  return (
    <div>
      <p className="text-[13px]" style={{ color: "var(--status-error)" }}>
        {friendly}
      </p>
      {hasDetail && (
        <>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-[11px] mt-1 cursor-pointer"
            style={{ color: "var(--text-tertiary)" }}
          >
            {showRaw ? "Hide details" : "Show details"}
          </button>
          {showRaw && (
            <pre
              className="text-[11px] mt-1 font-mono whitespace-pre-wrap break-all rounded px-2 py-1"
              style={{ color: "var(--text-tertiary)", background: "var(--bg-inset)" }}
            >
              {raw}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
