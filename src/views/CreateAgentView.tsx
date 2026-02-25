import { useState } from "react";
import {
  Package,
  Globe,
  Smartphone,
  ShoppingCart,
  Zap,
  Layers,
  Palette,
  ShieldCheck,
  Rocket,
} from "lucide-react";
import type { CreateAgentRequest } from "@/types";
import { createAgent } from "@/lib/api";

const STEPS = ["Idea", "Personality", "Schedule"] as const;

const TEMPLATES = [
  {
    id: "saas",
    name: "SaaS Product",
    icon: Package,
    subtitle: "Web app with auth & billing",
    mission:
      "Build a web application with user authentication, billing via Stripe, and an admin dashboard.",
  },
  {
    id: "landing",
    name: "Landing Page",
    icon: Globe,
    subtitle: "Marketing site",
    mission:
      "Create a beautiful, responsive marketing website to launch and promote my product.",
  },
  {
    id: "mobile",
    name: "Mobile App",
    icon: Smartphone,
    subtitle: "Cross-platform app",
    mission:
      "Build a cross-platform mobile application with modern UI and backend API.",
  },
  {
    id: "ecommerce",
    name: "E-commerce",
    icon: ShoppingCart,
    subtitle: "Online store",
    mission:
      "Build an online store with product catalog, shopping cart, and checkout flow.",
  },
] as const;

const PERSONALITIES = [
  {
    id: "move_fast",
    name: "Move Fast",
    icon: Zap,
    description: "Ships quickly, makes decisions on the fly. Gets things done fast.",
    bestFor: "Best for: MVPs and rapid prototyping",
  },
  {
    id: "build_carefully",
    name: "Build Carefully",
    icon: Layers,
    description: "Plans before building, writes thorough code. Takes longer but more solid.",
    bestFor: "Best for: production-quality projects",
  },
  {
    id: "explore_creatively",
    name: "Explore Creatively",
    icon: Palette,
    description: "Tries unconventional approaches, experiments freely.",
    bestFor: "Best for: novel ideas and creative work",
  },
] as const;

const CHECKIN_OPTIONS = [
  { label: "Every 30 min", sublabel: "Active building", value: 1800 },
  { label: "Every hour", sublabel: "Steady progress", value: 3600 },
  { label: "Every 4 hours", sublabel: "Light touch", value: 14400 },
  { label: "Once a day", sublabel: "Set and forget", value: 86400 },
] as const;

const AUTONOMY_OPTIONS = [
  {
    id: "semi",
    label: "Asks before big decisions",
    description:
      "Your agent will pause and notify you before deploying or making major changes.",
    icon: ShieldCheck,
  },
  {
    id: "yolo",
    label: "Works independently",
    description:
      "Your agent makes all decisions on its own. Review everything in the activity log.",
    icon: Rocket,
  },
] as const;

interface CreateAgentViewProps {
  onCreated: () => void;
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
      await createAgent(req);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 = mission.trim().length > 0;

  return (
    <div
      className="min-h-full flex flex-col items-center relative"
      style={{ paddingTop: 48 }}
    >
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
      <div className="w-full max-w-[520px] px-6 flex flex-col" style={{ gap: 32 }}>
        {/* Step indicator */}
        <div className="flex flex-col items-center" style={{ gap: 8 }}>
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

        {/* Step 1 */}
        {step === 1 && (
          <div
            className="flex flex-col"
            style={{ gap: 24, transition: "opacity 150ms ease-out" }}
          >
            <div>
              <h1
                className="font-semibold"
                style={{ fontSize: 28, color: "var(--text-primary)" }}
              >
                What do you want to build?
              </h1>
              <p
                className="mt-2"
                style={{
                  fontSize: 15,
                  color: "var(--text-secondary)",
                  marginTop: 8,
                }}
              >
                Describe your idea in a few sentences. Your agent will figure out
                the rest.
              </p>
            </div>

            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="I want to build a SaaS that helps small businesses track their inventory..."
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
                Or start from a template:
              </p>
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                style={{ gap: 8 }}
              >
                {TEMPLATES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMission(t.mission)}
                      className="flex flex-col items-start shrink-0 rounded-lg transition-all duration-150 ease-out cursor-pointer"
                      style={{
                        minWidth: 130,
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

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  width: 120,
                  height: 44,
                  fontSize: 15,
                  background: "var(--accent)",
                  color: "white",
                }}
                onMouseEnter={(e) => {
                  if (canProceedStep1) {
                    e.currentTarget.style.background = "var(--accent-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent)";
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div
            className="flex flex-col"
            style={{ gap: 24, transition: "opacity 150ms ease-out" }}
          >
            <div>
              <h1
                className="font-semibold"
                style={{ fontSize: 28, color: "var(--text-primary)" }}
              >
                How should your agent work?
              </h1>
              <p
                className="mt-2"
                style={{
                  fontSize: 15,
                  color: "var(--text-secondary)",
                  marginTop: 8,
                }}
              >
                Pick a working style that matches your goals.
              </p>
            </div>

            <div className="flex flex-col" style={{ gap: 16 }}>
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
                      border: selected
                        ? "2px solid var(--border-strong)"
                        : "1px solid var(--border-default)",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) {
                        e.currentTarget.style.background = "var(--bg-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) {
                        e.currentTarget.style.background = "var(--bg-surface)";
                      }
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

            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
                style={{
                  height: 44,
                  padding: "0 20px",
                  fontSize: 15,
                  background: "transparent",
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
              <button
                onClick={() => setStep(3)}
                className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
                style={{
                  width: 120,
                  height: 44,
                  fontSize: 15,
                  background: "var(--accent)",
                  color: "white",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--accent)";
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div
            className="flex flex-col"
            style={{ gap: 24, transition: "opacity 150ms ease-out" }}
          >
            <div>
              <h1
                className="font-semibold"
                style={{ fontSize: 28, color: "var(--text-primary)" }}
              >
                One last thing
              </h1>
              <p
                className="mt-2"
                style={{
                  fontSize: 15,
                  color: "var(--text-secondary)",
                  marginTop: 8,
                }}
              >
                Set up how your agent checks in and makes decisions.
              </p>
            </div>

            <div style={{ marginTop: 24 }}>
              <label
                className="block mb-2 font-medium"
                style={{ fontSize: 15, color: "var(--text-primary)" }}
              >
                How often should your agent check in?
              </label>
              <div
                className="grid grid-cols-2 gap-2"
                style={{ gap: 8 }}
              >
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
                        border: selected
                          ? "2px solid var(--border-strong)"
                          : "1px solid var(--border-default)",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected) {
                          e.currentTarget.style.background = "var(--bg-hover)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!selected) {
                          e.currentTarget.style.background = "var(--bg-surface)";
                        }
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

            <div style={{ marginTop: 24 }}>
              <label
                className="block mb-2 font-medium"
                style={{ fontSize: 15, color: "var(--text-primary)" }}
              >
                How should your agent make decisions?
              </label>
              <div className="flex gap-2" style={{ gap: 8 }}>
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
                        border: selected
                          ? "2px solid var(--border-strong)"
                          : "1px solid var(--border-default)",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected) {
                          e.currentTarget.style.background = "var(--bg-hover)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!selected) {
                          e.currentTarget.style.background = "var(--bg-surface)";
                        }
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

            <div className="flex flex-col" style={{ gap: 12 }}>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
                  style={{
                    height: 44,
                    padding: "0 20px",
                    fontSize: 15,
                    background: "transparent",
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
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{
                    height: 44,
                    fontSize: 16,
                    background: "var(--accent)",
                    color: "white",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSubmitting) {
                      e.currentTarget.style.background = "var(--accent-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--accent)";
                  }}
                >
                  {isSubmitting ? "Starting..." : "Start Building"}
                </button>
              </div>
              {error && (
                <p
                  className="text-[13px]"
                  style={{ color: "var(--status-error)" }}
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
