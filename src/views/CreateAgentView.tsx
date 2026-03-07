import { useState } from "react";
import { Briefcase, Code2, TrendingUp, HandCoins, Calculator, Lightbulb } from "lucide-react";
import type { Agent, CreateAgentRequest } from "@/types";
import { PERSONALITIES, CHECKIN_OPTIONS, AUTONOMY_OPTIONS } from "@/lib/wizardConstants";
import { createAgent } from "@/lib/api";
import FriendlyError from "@/components/FriendlyError";
import { extractError } from "@/lib/friendlyErrors";

const STEPS = ["Role", "Work Style", "Schedule"] as const;

const ROLE_TEMPLATES = [
  {
    id: "general",
    name: "General Co-Founder",
    icon: Briefcase,
    subtitle: "Strategy, product, growth — everything",
    mission:
      "Build and grow my business — handle strategy, product, engineering, marketing, and growth.",
  },
  {
    id: "cto",
    name: "CTO / Technical",
    icon: Code2,
    subtitle: "Architecture, code, infrastructure",
    mission:
      "Own the technical strategy and engineering — build the product, ship features, manage infrastructure.",
  },
  {
    id: "growth",
    name: "Growth / Marketing",
    icon: TrendingUp,
    subtitle: "Users, content, funnels, SEO",
    mission:
      "Drive user acquisition and revenue growth — run experiments, create content, optimize funnels, find distribution.",
  },
  {
    id: "sales",
    name: "Sales",
    icon: HandCoins,
    subtitle: "Outreach, pipeline, revenue",
    mission:
      "Build and run the sales engine — research prospects, write outreach, prepare proposals, close deals.",
  },
  {
    id: "finance",
    name: "Finance / Ops",
    icon: Calculator,
    subtitle: "Budgets, runway, operations",
    mission:
      "Manage finances and operations — build models, track runway, automate workflows, keep the business running.",
  },
  {
    id: "product",
    name: "Product",
    icon: Lightbulb,
    subtitle: "Features, UX, user feedback",
    mission:
      "Own product strategy — prioritize features, design user flows, synthesize feedback, ship what matters.",
  },
] as const;

interface CreateAgentViewProps {
  onCreated: (agent: Agent) => Promise<void> | void;
  onCancel: () => void;
}

export default function CreateAgentView({ onCreated, onCancel }: CreateAgentViewProps) {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [mission, setMission] = useState("");
  const [personality, setPersonality] = useState<
    "move_fast" | "build_carefully" | "explore_creatively"
  >("move_fast");
  const [checkinInterval, setCheckinInterval] = useState(1800);
  const [autonomyLevel, setAutonomyLevel] = useState<"semi" | "yolo">("semi");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const req: CreateAgentRequest = {
        name: projectName || "My Awesome Project",
        mission,
        personality,
        checkin_interval_secs: checkinInterval,
        autonomy_level: autonomyLevel,
      };
      const created = await createAgent(req);
      await onCreated(created);
    } catch (e) {
      setError(extractError(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 = mission.trim().length > 0;

  const handleBack = () => setStep((s) => Math.max(1, s - 1));
  const handleNext = () => {
    if (step === 3) {
      handleSubmit();
    } else {
      setStep((s) => s + 1);
    }
  };

  const canProceed =
    step === 1 ? canProceedStep1 : step === 2 ? true : !isSubmitting;

  return (
    <div className="h-full flex flex-col">
      {/* Top bar: step indicator + cancel */}
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
                      background:
                        i + 1 < step
                          ? "var(--status-active)"
                          : "var(--border-default)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <span
            className="text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
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
                <h1
                  className="font-semibold"
                  style={{ fontSize: 28, color: "var(--text-primary)" }}
                >
                  What kind of co-founder do you need?
                </h1>
                <p
                  className="mt-2"
                  style={{ fontSize: 15, color: "var(--text-secondary)" }}
                >
                  Pick a role or describe your mission. Your co-founder takes it from there.
                </p>
              </div>

              <textarea
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                placeholder="I want to launch a DTC brand in LatAm, build an MVP, grow to 1K users..."
                rows={4}
                className="w-full rounded-lg resize-none outline-none transition-all duration-150 ease-out"
                style={{
                  fontSize: 17,
                  padding: 16,
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border-default)",
                }}
              />

              <div>
                <p
                  className="mb-2"
                  style={{ fontSize: 13, color: "var(--text-tertiary)" }}
                >
                  Or pick a co-founder role:
                </p>
                <div className="grid grid-cols-3 gap-2 pb-1">
                  {ROLE_TEMPLATES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMission(t.mission)}
                        className="flex flex-col items-start rounded-lg transition-all duration-150 ease-out cursor-pointer"
                        style={{
                          padding: 12,
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border-default)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <Icon
                          size={20}
                          style={{ color: "var(--text-secondary)", marginBottom: 6 }}
                        />
                        <span
                          className="font-medium"
                          style={{ fontSize: 13, color: "var(--text-primary)" }}
                        >
                          {t.name}
                        </span>
                        <span
                          className="mt-0.5"
                          style={{ fontSize: 12, color: "var(--text-tertiary)" }}
                        >
                          {t.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  className="block mb-2"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  Give your project a name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Awesome Project"
                  className="w-full rounded-lg outline-none transition-all duration-150 ease-out"
                  style={{
                    fontSize: 15,
                    height: 44,
                    padding: "0 16px",
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border-default)",
                  }}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1
                  className="font-semibold"
                  style={{ fontSize: 28, color: "var(--text-primary)" }}
                >
                  How should your co-founder work?
                </h1>
                <p
                  className="mt-2"
                  style={{ fontSize: 15, color: "var(--text-secondary)" }}
                >
                  Pick a working style that matches your goals.
                </p>
              </div>

              <div className="flex flex-col gap-3">
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
                        padding: 20,
                        background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                        border: "2px solid",
                        borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected)
                          e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!selected)
                          e.currentTarget.style.background = "var(--bg-surface)";
                      }}
                    >
                      <Icon
                        size={24}
                        style={{ color: "var(--text-secondary)", flexShrink: 0 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="font-semibold"
                          style={{ fontSize: 16, color: "var(--text-primary)" }}
                        >
                          {p.name}
                        </div>
                        <p
                          className="mt-1"
                          style={{ fontSize: 14, color: "var(--text-secondary)" }}
                        >
                          {p.description}
                        </p>
                        <p
                          className="mt-1 italic"
                          style={{ fontSize: 13, color: "var(--text-tertiary)" }}
                        >
                          {p.bestFor}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-7">
              <div>
                <h1
                  className="font-semibold"
                  style={{ fontSize: 28, color: "var(--text-primary)" }}
                >
                  One last thing
                </h1>
                <p
                  className="mt-2"
                  style={{ fontSize: 15, color: "var(--text-secondary)" }}
                >
                  Set up how your co-founder checks in and makes decisions.
                </p>
              </div>

              <div>
                <label
                  className="block mb-2 font-medium"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  How often should your co-founder check in?
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
                          if (!selected)
                            e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected)
                            e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <div
                          className="font-medium"
                          style={{ fontSize: 14, color: "var(--text-primary)" }}
                        >
                          {opt.label}
                        </div>
                        <div
                          className="mt-0.5"
                          style={{ fontSize: 12, color: "var(--text-tertiary)" }}
                        >
                          {opt.sublabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  className="block mb-2 font-medium"
                  style={{ fontSize: 15, color: "var(--text-primary)" }}
                >
                  How should your co-founder make decisions?
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
                          if (!selected)
                            e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!selected)
                            e.currentTarget.style.background = "var(--bg-surface)";
                        }}
                      >
                        <Icon
                          size={20}
                          style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 1 }}
                        />
                        <div className="min-w-0">
                          <div
                            className="font-medium"
                            style={{ fontSize: 14, color: "var(--text-primary)" }}
                          >
                            {opt.label}
                          </div>
                          <p
                            className="mt-0.5"
                            style={{ fontSize: 13, color: "var(--text-secondary)" }}
                          >
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
                ? "Starting..."
                : "Launch Co-Founder"
              : "Next"}
          </button>
        </div>
        {error && (
          <div className="w-full max-w-[520px] mx-auto px-6 pb-3">
            <FriendlyError error={error} />
          </div>
        )}
      </div>
    </div>
  );
}
