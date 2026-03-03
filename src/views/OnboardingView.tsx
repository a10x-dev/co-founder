import { useState } from "react";
import {
  Rocket,
  Package,
  Globe,
  Smartphone,
  ShoppingCart,
  TrendingUp,
  Code,
  Lightbulb,
  ArrowRight,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import type { Agent, CreateAgentRequest } from "@/types";
import { PERSONALITIES, CHECKIN_OPTIONS, AUTONOMY_OPTIONS } from "@/lib/wizardConstants";
import { createAgent } from "@/lib/api";
import FriendlyError from "@/components/FriendlyError";
import { extractError } from "@/lib/friendlyErrors";

const MISSION_TEMPLATES = [
  {
    id: "mvp",
    icon: Rocket,
    name: "Build my MVP from scratch",
    description: "Turn an idea into a working product. Perfect for non-technical founders.",
    mission: "Build a minimum viable product from scratch. Start with the core feature, make it work end-to-end, then iterate.",
  },
  {
    id: "saas",
    icon: Package,
    name: "SaaS with auth & billing",
    description: "Web app with user login, Stripe payments, and a dashboard.",
    mission: "Build a web application with user authentication, billing via Stripe, and an admin dashboard.",
  },
  {
    id: "landing",
    icon: Globe,
    name: "Launch a marketing site",
    description: "Beautiful, responsive landing page to promote your product.",
    mission: "Create a beautiful, responsive marketing website to launch and promote my product.",
  },
  {
    id: "growth",
    icon: TrendingUp,
    name: "Grow to $10K MRR",
    description: "Optimize an existing product for growth and revenue.",
    mission: "Analyze the current product, identify growth opportunities, implement features that drive user acquisition and retention, and optimize for revenue.",
  },
  {
    id: "mobile",
    icon: Smartphone,
    name: "Build a mobile app",
    description: "Cross-platform mobile app with modern UI.",
    mission: "Build a cross-platform mobile application with modern UI and backend API.",
  },
  {
    id: "ecommerce",
    icon: ShoppingCart,
    name: "Launch an online store",
    description: "Product catalog, cart, checkout, and order management.",
    mission: "Build an online store with product catalog, shopping cart, and checkout flow.",
  },
  {
    id: "quality",
    icon: Code,
    name: "Improve code quality",
    description: "Tests, refactoring, and technical debt. For technical founders.",
    mission: "Improve code quality and test coverage. Refactor areas with technical debt, add missing tests, and improve architecture.",
  },
  {
    id: "custom",
    icon: Lightbulb,
    name: "Custom mission",
    description: "Describe exactly what you want built.",
    mission: "",
  },
] as const;

interface OnboardingViewProps {
  onCreated: (agent: Agent) => Promise<void> | void;
  onImport: () => void;
}

export default function OnboardingView({ onCreated, onImport }: OnboardingViewProps) {
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [customMission, setCustomMission] = useState("");
  const [projectName, setProjectName] = useState("");
  const [personality, setPersonality] = useState<"move_fast" | "build_carefully" | "explore_creatively">("move_fast");
  const [checkinInterval, setCheckinInterval] = useState(1800);
  const [autonomyLevel, setAutonomyLevel] = useState<"semi" | "yolo">("semi");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = MISSION_TEMPLATES.find((t) => t.id === selectedTemplate);
  const mission = selectedTemplate === "custom" ? customMission : (template?.mission ?? "");

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const req: CreateAgentRequest = {
        name: projectName || "My Startup",
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

  if (step === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center max-w-[520px] px-6" style={{ marginTop: -40 }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: "var(--accent-subtle)" }}
          >
            <Sparkles size={28} strokeWidth={1.5} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-[28px] font-semibold text-center mb-2" style={{ color: "var(--text-primary)" }}>
            Welcome to Co-Founder
          </h1>
          <p className="text-[16px] text-center mb-8 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Your AI co-founder builds, ships, and iterates while you focus on the big picture.
            It works around the clock — even while you sleep.
          </p>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setStep(1)}
              className="flex-1 flex items-center justify-center gap-2 h-12 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
            >
              <Rocket size={18} strokeWidth={2} />
              Create your co-founder
            </button>
            <button
              onClick={onImport}
              className="flex items-center justify-center gap-2 px-5 h-12 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
            >
              <FolderOpen size={18} strokeWidth={2} />
              Import project
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[580px] mx-auto px-6 py-10">
            <h1 className="text-[28px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
              What's the mission?
            </h1>
            <p className="text-[15px] mb-6" style={{ color: "var(--text-secondary)" }}>
              Pick a starting point, or describe your own idea.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MISSION_TEMPLATES.map((t) => {
                const Icon = t.icon;
                const selected = selectedTemplate === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t.id)}
                    className="flex flex-col items-start rounded-xl text-left transition-all duration-150 ease-out cursor-pointer"
                    style={{
                      padding: 16,
                      background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                      border: "2px solid",
                      borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = selected ? "var(--accent-subtle)" : "var(--bg-surface)"; }}
                  >
                    <Icon size={20} className="mb-2" style={{ color: selected ? "var(--accent)" : "var(--text-secondary)" }} />
                    <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.name}</span>
                    <span className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{t.description}</span>
                  </button>
                );
              })}
            </div>
            {selectedTemplate === "custom" && (
              <textarea
                value={customMission}
                onChange={(e) => setCustomMission(e.target.value)}
                placeholder="I want to build..."
                rows={4}
                className="w-full rounded-lg resize-none outline-none mt-4 transition-all duration-150 ease-out"
                style={{
                  fontSize: 16,
                  padding: 16,
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
                autoFocus
              />
            )}
          </div>
        </div>
        <div className="shrink-0 border-t" style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}>
          <div className="max-w-[580px] mx-auto px-6 py-4 flex items-center gap-3">
            <button
              onClick={() => setStep(0)}
              className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
              style={{ height: 44, padding: "0 20px", fontSize: 15, color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!selectedTemplate || (selectedTemplate === "custom" && !customMission.trim())}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ height: 44, fontSize: 15, background: "var(--accent)", color: "white" }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[520px] mx-auto px-6 py-10">
          <h1 className="text-[28px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Almost there
          </h1>
          <p className="text-[15px] mb-6" style={{ color: "var(--text-secondary)" }}>
            Give your project a name and pick how your co-founder should work.
          </p>

          <div className="space-y-6">
            <div>
              <label className="block text-[15px] mb-2" style={{ color: "var(--text-primary)" }}>
                Project name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Startup"
                className="w-full rounded-lg outline-none transition-all duration-150 ease-out"
                style={{ fontSize: 15, height: 44, padding: "0 16px", background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              />
            </div>

            <div>
              <label className="block text-[15px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>
                Working style
              </label>
              <div className="flex flex-col gap-2.5">
                {PERSONALITIES.map((p) => {
                  const Icon = p.icon;
                  const selected = personality === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPersonality(p.id)}
                      className="flex items-start gap-4 rounded-xl text-left transition-all duration-150 ease-out cursor-pointer"
                      style={{
                        padding: 16,
                        background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                        border: "2px solid",
                        borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = selected ? "var(--accent-subtle)" : "var(--bg-surface)"; }}
                    >
                      <Icon size={20} style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 2 }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold" style={{ fontSize: 15, color: "var(--text-primary)" }}>{p.name}</div>
                        <p className="mt-0.5" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{p.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[15px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>
                Check-in frequency
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CHECKIN_OPTIONS.map((opt) => {
                  const selected = checkinInterval === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setCheckinInterval(opt.value)}
                      className="rounded-lg text-center transition-all duration-150 ease-out cursor-pointer"
                      style={{
                        padding: 14,
                        background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                        border: "2px solid",
                        borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = selected ? "var(--accent-subtle)" : "var(--bg-surface)"; }}
                    >
                      <div className="font-medium" style={{ fontSize: 14, color: "var(--text-primary)" }}>{opt.label}</div>
                      <div className="mt-0.5" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{opt.sublabel}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[15px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>
                Decision-making
              </label>
              <div className="flex gap-2">
                {AUTONOMY_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = autonomyLevel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setAutonomyLevel(opt.id)}
                      className="flex-1 flex items-start gap-3 rounded-lg text-left transition-all duration-150 ease-out cursor-pointer"
                      style={{
                        padding: 14,
                        background: selected ? "var(--accent-subtle)" : "var(--bg-surface)",
                        border: "2px solid",
                        borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = selected ? "var(--accent-subtle)" : "var(--bg-surface)"; }}
                    >
                      <Icon size={18} style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 2 }} />
                      <div className="min-w-0">
                        <div className="font-medium" style={{ fontSize: 13, color: "var(--text-primary)" }}>{opt.label}</div>
                        <p className="mt-0.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{opt.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t" style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}>
        <div className="max-w-[520px] mx-auto px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => setStep(1)}
            className="rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer"
            style={{ height: 44, padding: "0 20px", fontSize: 15, color: "var(--text-secondary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ height: 44, fontSize: 15, background: "var(--accent)", color: "white" }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
          >
            {isSubmitting ? "Starting..." : "Start Building"}
          </button>
        </div>
        {error && (
          <div className="max-w-[520px] mx-auto px-6 pb-3">
            <FriendlyError error={error} />
          </div>
        )}
      </div>
    </div>
  );
}
