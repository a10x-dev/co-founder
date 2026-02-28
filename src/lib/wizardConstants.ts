import { Zap, Layers, Palette, ShieldCheck, Rocket } from "lucide-react";

export const PERSONALITIES = [
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

export const CHECKIN_OPTIONS = [
  { label: "Every 30 min", sublabel: "Active building", value: 1800 },
  { label: "Every hour", sublabel: "Steady progress", value: 3600 },
  { label: "Every 4 hours", sublabel: "Light touch", value: 14400 },
  { label: "Once a day", sublabel: "Set and forget", value: 86400 },
] as const;

export const AUTONOMY_OPTIONS = [
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
