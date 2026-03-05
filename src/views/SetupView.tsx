import { useState, useEffect } from "react";
import { Terminal, Download, CheckCircle2, AlertCircle, Loader2, ExternalLink, FolderOpen } from "lucide-react";
import { installClaudeCli, checkClaudeCliStatus, getGlobalSettings, updateGlobalSettings } from "@/lib/api";

interface SetupViewProps {
  onComplete: () => void;
}

export default function SetupView({ onComplete }: SetupViewProps) {
  const [step, setStep] = useState<"check" | "installing" | "verify" | "manual">("check");
  const [installOutput, setInstallOutput] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [cliStatus, setCliStatus] = useState<{installed: boolean; version: string | null} | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const handleInstall = async () => {
    setStep("installing");
    setInstallError(null);
    setInstallOutput("");
    try {
      const output = await installClaudeCli();
      setInstallOutput(output);
      // Verify after install
      const status = await checkClaudeCliStatus();
      setCliStatus(status);
      setStep("verify");
    } catch (err) {
      setInstallError(typeof err === "string" ? err : (err as Error)?.message ?? "Installation failed");
      setStep("check");
    }
  };

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      const status = await checkClaudeCliStatus();
      setCliStatus(status);
      if (status.installed) {
        onComplete();
      } else {
        setRechecking(false);
      }
    } catch {
      setRechecking(false);
    }
  };

  const handleManualPath = async () => {
    const trimmed = manualPath.trim();
    if (!trimmed) return;
    setManualError(null);
    try {
      // Save the user-provided path to global settings so the backend uses it
      const settings = await getGlobalSettings();
      await updateGlobalSettings({ ...settings, claude_cli_path: trimmed });
      // Re-check — the backend will now find the CLI at the configured path
      const status = await checkClaudeCliStatus();
      if (status.installed) {
        onComplete();
      } else {
        setManualError("Could not verify Claude Code at this path.");
      }
    } catch {
      setManualError("Could not verify Claude Code at this path.");
    }
  };

  // Step: Installing
  if (step === "installing") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center max-w-[520px] px-6" style={{ marginTop: -40 }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: "var(--accent-subtle)" }}
          >
            <Loader2 size={28} strokeWidth={1.5} className="animate-spin" style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
            Installing Claude Code
          </h1>
          <p className="text-[16px] text-center mb-6" style={{ color: "var(--text-secondary)" }}>
            This usually takes less than a minute…
          </p>
          <div
            className="w-full rounded-lg p-4 text-[12px] leading-5 max-h-40 overflow-y-auto"
            style={{
              background: "var(--bg-inset)",
              color: "var(--text-tertiary)",
              fontFamily: "'Geist Mono', monospace",
              border: "1px solid var(--border-default)",
            }}
          >
            {installOutput || "Running installer…"}
          </div>
        </div>
      </div>
    );
  }

  // Step: Verify
  if (step === "verify") {
    const installed = cliStatus?.installed;
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center max-w-[520px] px-6" style={{ marginTop: -40 }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: installed ? "color-mix(in srgb, var(--status-active) 10%, transparent)" : "var(--accent-subtle)" }}
          >
            {installed ? (
              <CheckCircle2 size={28} strokeWidth={1.5} style={{ color: "var(--status-active)" }} />
            ) : (
              <Terminal size={28} strokeWidth={1.5} style={{ color: "var(--accent)" }} />
            )}
          </div>

          {installed ? (
            <>
              <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
                You're all set!
              </h1>
              <p className="text-[16px] text-center mb-2" style={{ color: "var(--text-secondary)" }}>
                Claude Code {cliStatus?.version ?? ""} is installed and ready.
              </p>
              <button
                onClick={onComplete}
                className="mt-6 flex items-center justify-center gap-2 h-12 px-8 rounded-lg font-medium text-[15px] cursor-pointer"
                style={{ background: "var(--accent)", color: "white" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
              >
                Get Started
              </button>
            </>
          ) : (
            <>
              <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
                Almost there — log in to Claude
              </h1>
              <p className="text-[16px] text-center mb-6 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Claude Code is installed. Open your terminal and run <code className="px-1.5 py-0.5 rounded text-[14px]" style={{ background: "var(--bg-inset)", fontFamily: "'Geist Mono', monospace" }}>claude</code> to log in with your Anthropic account.
              </p>
              <p className="text-[13px] text-center mb-6" style={{ color: "var(--text-tertiary)" }}>
                You need a Claude Pro, Max, Teams, or Enterprise subscription.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleRecheck}
                  disabled={rechecking}
                  className="flex items-center justify-center gap-2 h-12 px-6 rounded-lg font-medium text-[15px] cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "white" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
                >
                  {rechecking ? <Loader2 size={16} className="animate-spin" /> : null}
                  I've logged in — Re-check
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Step: Manual path
  if (step === "manual") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center max-w-[520px] px-6" style={{ marginTop: -40 }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: "var(--accent-subtle)" }}
          >
            <FolderOpen size={28} strokeWidth={1.5} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
            Locate Claude Code
          </h1>
          <p className="text-[16px] text-center mb-6" style={{ color: "var(--text-secondary)" }}>
            Enter the full path to the <code className="px-1.5 py-0.5 rounded text-[14px]" style={{ background: "var(--bg-inset)", fontFamily: "'Geist Mono', monospace" }}>claude</code> binary.
          </p>
          <div className="w-full flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/usr/local/bin/claude"
              className="flex-1 rounded-lg outline-none"
              style={{ fontSize: 14, height: 44, padding: "0 14px", background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontFamily: "'Geist Mono', monospace" }}
            />
            <button
              onClick={handleManualPath}
              disabled={!manualPath.trim()}
              className="h-11 px-5 rounded-lg font-medium text-[14px] cursor-pointer disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Verify
            </button>
          </div>
          {manualError && (
            <p className="mt-2 text-[13px]" style={{ color: "var(--status-error)" }}>{manualError}</p>
          )}
          <button
            onClick={() => setStep("check")}
            className="mt-4 text-[13px] cursor-pointer"
            style={{ color: "var(--text-tertiary)" }}
          >
            ← Back to install
          </button>
        </div>
      </div>
    );
  }

  // Step: Check (initial / not installed)
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center max-w-[520px] px-6" style={{ marginTop: -40 }}>
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: "var(--accent-subtle)" }}
        >
          <Terminal size={28} strokeWidth={1.5} style={{ color: "var(--accent)" }} />
        </div>
        <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
          Set up Claude Code
        </h1>
        <p className="text-[16px] text-center mb-8 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Co-Founder uses Claude Code to power your AI co-founders.<br />
          Let's install it — it only takes a moment.
        </p>

        {installError && (
          <div
            className="w-full rounded-lg px-4 py-3 mb-4 flex items-start gap-2"
            style={{ background: "color-mix(in srgb, var(--status-error) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)" }}
          >
            <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--status-error)" }} />
            <p className="text-[13px]" style={{ color: "var(--status-error)" }}>{installError}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={handleInstall}
            className="flex items-center justify-center gap-2 h-12 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
            style={{ background: "var(--accent)", color: "white" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
          >
            <Download size={18} strokeWidth={2} />
            Install Claude Code
          </button>
          <div className="flex items-center justify-center gap-4 mt-1">
            <button
              onClick={() => setStep("manual")}
              className="text-[13px] cursor-pointer"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              I already have it installed
            </button>
            <span style={{ color: "var(--border-default)" }}>·</span>
            <a
              href="https://code.claude.com/docs/en/quickstart"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] flex items-center gap-1"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              Learn more <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
