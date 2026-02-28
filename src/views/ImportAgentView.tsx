import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderCheck } from "lucide-react";
import type { ImportAgentRequest } from "@/types";
import { PERSONALITIES, CHECKIN_OPTIONS, AUTONOMY_OPTIONS } from "@/lib/wizardConstants";
import { importAgent, readTextFile } from "@/lib/api";

const STEPS = ["Project", "Mission", "Schedule"] as const;

const PROJECT_TYPE_BADGES: Record<string, string> = {
  "package.json": "Node.js",
  "Cargo.toml": "Rust",
  "requirements.txt": "Python",
  "pyproject.toml": "Python",
  "go.mod": "Go",
  "pom.xml": "Java",
  "Gemfile": "Ruby",
  "composer.json": "PHP",
  "pubspec.yaml": "Flutter",
};

interface ImportAgentViewProps {
  onImported: () => void;
  onCancel: () => void;
}

export default function ImportAgentView({ onImported, onCancel }: ImportAgentViewProps) {
  const [step, setStep] = useState(1);
  const [folderPath, setFolderPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [alreadyHasFounder, setAlreadyHasFounder] = useState(false);
  const [mission, setMission] = useState("");
  const [personality, setPersonality] = useState<
    "move_fast" | "build_carefully" | "explore_creatively"
  >("move_fast");
  const [checkinInterval, setCheckinInterval] = useState(1800);
  const [autonomyLevel, setAutonomyLevel] = useState<"semi" | "yolo">("semi");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose Project Folder" });
      if (!selected || typeof selected !== "string") return;

      setFolderPath(selected);
      setError(null);
      setDetectedType(null);

      const folderName = selected.split("/").filter(Boolean).pop() ?? "My Project";
      setProjectName(folderName);

      for (const [filename, label] of Object.entries(PROJECT_TYPE_BADGES)) {
        try {
          await readTextFile(`${selected}/${filename}`);
          setDetectedType(label);
          break;
        } catch {
          // file doesn't exist
        }
      }

      try {
        await readTextFile(`${selected}/.founder/MISSION.md`);
        setAlreadyHasFounder(true);
      } catch {
        setAlreadyHasFounder(false);
      }

      try {
        const readme = await readTextFile(`${selected}/README.md`);
        const firstPara = readme
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .slice(0, 3)
          .join(" ");
        if (firstPara) setMission(firstPara);
      } catch {
        // no README
      }
    } catch {
      setError("Could not open folder picker");
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const req: ImportAgentRequest = {
        workspace_path: folderPath,
        name: projectName || "Imported Project",
        mission,
        personality,
        checkin_interval_secs: checkinInterval,
        autonomy_level: autonomyLevel,
      };
      await importAgent(req);
      onImported();
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 = folderPath.length > 0;
  const canProceedStep2 = mission.trim().length > 0;

  const handleBack = () => setStep((s) => Math.max(1, s - 1));
  const handleNext = () => {
    if (step === 3) {
      handleSubmit();
    } else {
      setStep((s) => s + 1);
    }
  };

  const canProceed =
    step === 1 ? canProceedStep1 : step === 2 ? canProceedStep2 : !isSubmitting;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 relative pt-6 pb-4 flex justify-center">
        <button
          onClick={onCancel}
          className="absolute top-6 right-6 rounded-lg px-3 py-1.5 text-[14px] font-medium transition-all duration-150 ease-out cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          Cancel
        </button>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center">
            {STEPS.map((_, i) => (
              <div key={i} className="flex items-center">
                <div
                  className="rounded-full shrink-0 transition-all duration-150 ease-out"
                  style={{
                    width: 10,
                    height: 10,
                    background:
                      i + 1 < step
                        ? "var(--status-active)"
                        : i + 1 === step
                          ? "var(--accent)"
                          : "var(--border-default)",
                  }}
                />
                {i < STEPS.length - 1 && (
                  <div
                    className="shrink-0 transition-all duration-150 ease-out"
                    style={{
                      width: 40,
                      height: 2,
                      background: i + 1 < step ? "var(--status-active)" : "var(--border-default)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {STEPS[step - 1]}
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-[520px] mx-auto px-6 py-6">
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="font-semibold" style={{ fontSize: 28, color: "var(--text-primary)" }}>
                  Which project?
                </h1>
                <p className="mt-2" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
                  Point your agent at an existing folder on your computer.
                </p>
              </div>

              <button
                type="button"
                onClick={handleChooseFolder}
                className="w-full flex items-center gap-4 rounded-xl border-2 border-dashed transition-all duration-150 ease-out cursor-pointer"
                style={{
                  padding: 24,
                  borderColor: folderPath ? "var(--status-active)" : "var(--border-default)",
                  background: folderPath ? "var(--accent-subtle)" : "var(--bg-inset)",
                }}
                onMouseEnter={(e) => {
                  if (!folderPath) e.currentTarget.style.borderColor = "var(--text-tertiary)";
                }}
                onMouseLeave={(e) => {
                  if (!folderPath) e.currentTarget.style.borderColor = "var(--border-default)";
                }}
              >
                {folderPath ? (
                  <FolderCheck size={28} style={{ color: "var(--status-active)", flexShrink: 0 }} />
                ) : (
                  <FolderOpen size={28} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                )}
                <div className="text-left min-w-0">
                  {folderPath ? (
                    <>
                      <div
                        className="font-medium truncate"
                        style={{ fontSize: 15, color: "var(--text-primary)" }}
                      >
                        {folderPath.split("/").pop()}
                      </div>
                      <div
                        className="truncate mt-0.5"
                        style={{ fontSize: 12, color: "var(--text-tertiary)" }}
                      >
                        {folderPath}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 15, color: "var(--text-secondary)" }}>
                      Click to choose a folder
                    </span>
                  )}
                </div>
              </button>

              {folderPath && (
                <div className="flex flex-col gap-2">
                  {detectedType && (
                    <div className="flex items-center gap-2">
                      <span
                        className="px-2.5 py-1 rounded-full text-[13px] font-medium"
                        style={{
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-default)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {detectedType} project detected
                      </span>
                    </div>
                  )}
                  {alreadyHasFounder && (
                    <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                      This folder already has an agent setup — it will be reconnected.
                    </p>
                  )}
                </div>
              )}

              {folderPath && (
                <div>
                  <label
                    className="block mb-2"
                    style={{ fontSize: 15, color: "var(--text-primary)" }}
                  >
                    Name this agent
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="My Project"
                    className="w-full rounded-lg outline-none transition-all duration-150 ease-out"
                    style={{
                      fontSize: 15,
                      height: 44,
                      padding: "0 16px",
                      background: "var(--bg-inset)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="font-semibold" style={{ fontSize: 28, color: "var(--text-primary)" }}>
                  What should your agent work on?
                </h1>
                <p className="mt-2" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
                  Tell your agent what to focus on in this project.
                  {mission && " We pre-filled this from your README — edit as needed."}
                </p>
              </div>

              <textarea
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                placeholder="Continue building the authentication system, then move on to the dashboard..."
                rows={5}
                className="w-full rounded-lg resize-none outline-none transition-all duration-150 ease-out"
                style={{
                  fontSize: 16,
                  padding: 16,
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                  lineHeight: 1.6,
                }}
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-7">
              <div>
                <h1 className="font-semibold" style={{ fontSize: 28, color: "var(--text-primary)" }}>
                  Almost done
                </h1>
                <p className="mt-2" style={{ fontSize: 15, color: "var(--text-secondary)" }}>
                  Set up your agent's working style and check-in schedule.
                </p>
              </div>

              <div>
                <label
                  className="block mb-3 font-medium"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  Working style
                </label>
                <div className="flex flex-col gap-2.5">
                  {PERSONALITIES.map((p) => {
                    const Icon = p.icon;
                    const selected = personality === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPersonality(p.id)}
                        className="flex items-start gap-4 rounded-xl text-left transition-all duration-150 ease-out cursor-pointer"
                        style={{
                          padding: 16,
                          background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                          border: "2px solid",
                          borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <Icon size={20} style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 2 }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold" style={{ fontSize: 15, color: "var(--text-primary)" }}>
                            {p.name}
                          </div>
                          <p className="mt-0.5" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                            {p.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  className="block mb-3 font-medium"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  How often should your agent check in?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CHECKIN_OPTIONS.map((opt) => {
                    const selected = checkinInterval === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setCheckinInterval(opt.value)}
                        className="rounded-lg text-center transition-all duration-150 ease-out cursor-pointer"
                        style={{
                          padding: 14,
                          background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                          border: "2px solid",
                          borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <div className="font-medium" style={{ fontSize: 14, color: "var(--text-primary)" }}>
                          {opt.label}
                        </div>
                        <div className="mt-0.5" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                          {opt.sublabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  className="block mb-3 font-medium"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  How should your agent make decisions?
                </label>
                <div className="flex gap-2">
                  {AUTONOMY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = autonomyLevel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAutonomyLevel(opt.id)}
                        className="flex-1 flex items-start gap-3 rounded-lg text-left transition-all duration-150 ease-out cursor-pointer"
                        style={{
                          padding: 14,
                          background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                          border: "2px solid",
                          borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <Icon size={18} style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 2 }} />
                        <div className="min-w-0">
                          <div className="font-medium" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                            {opt.label}
                          </div>
                          <p className="mt-0.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {opt.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pinned footer */}
      <div
        className="shrink-0 border-t"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-app)",
        }}
      >
        <div className="w-full max-w-[520px] mx-auto px-6 py-4 flex items-center gap-3">
          {step > 1 && (
            <button
              onClick={handleBack}
              className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
              style={{
                height: 44,
                padding: "0 20px",
                fontSize: 15,
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              Back
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={!canProceed}
            className="flex-1 rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              height: 44,
              fontSize: 15,
              background: "var(--accent)",
              color: "white",
            }}
            onMouseEnter={(e) => {
              if (canProceed)
                e.currentTarget.style.background = "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--accent)";
            }}
          >
            {step === 3
              ? isSubmitting
                ? "Importing..."
                : "Import Project"
              : "Next"}
          </button>
        </div>
        {error && (
          <div className="w-full max-w-[520px] mx-auto px-6 pb-3">
            <p className="text-[13px]" style={{ color: "var(--status-error)" }}>
              {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
