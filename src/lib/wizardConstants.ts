import { Zap, Layers, Palette, ShieldCheck, Rocket } from "lucide-react";

export const PERSONALITIES = [
  {
    id: "move_fast",
    name: "Move Fast",
    icon: Zap,
    description:
      "Ships first, iterates second. Bias toward action. Gets things done fast.",
    bestFor: "Best for: MVPs, launches, and rapid growth",
  },
  {
    id: "build_carefully",
    name: "Build Carefully",
    icon: Layers,
    description:
      "Plans before acting. Thorough research, solid execution. Takes longer but rock-solid.",
    bestFor: "Best for: complex projects and long-term strategy",
  },
  {
    id: "explore_creatively",
    name: "Explore Creatively",
    icon: Palette,
    description:
      "Tries unconventional approaches. Experiments freely. Innovation over convention.",
    bestFor: "Best for: novel ideas and creative problem-solving",
  },
] as const;

export const CHECKIN_OPTIONS = [
  {
    label: "Every 10 min",
    sublabel: "Intense grinding",
    value: 600,
  },
  {
    label: "Every 30 min",
    sublabel: "Active building",
    value: 1800,
  },
  {
    label: "Every hour",
    sublabel: "Steady progress",
    value: 3600,
  },
  {
    label: "Every 4 hours",
    sublabel: "Light touch",
    value: 14400,
  },
] as const;

export const AUTONOMY_OPTIONS = [
  {
    id: "semi",
    label: "Asks before big decisions",
    description:
      "Your co-founder will pause and notify you before deploying or making major changes.",
    icon: ShieldCheck,
  },
  {
    id: "yolo",
    label: "Full autonomy",
    description:
      "Your co-founder makes all decisions independently. Review everything in the activity log.",
    icon: Rocket,
  },
] as const;
