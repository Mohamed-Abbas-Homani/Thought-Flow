import { completeLLM, type LLMMessage } from "./llm";
import {
  themes,
  type ColorMode,
  type Theme,
  type ThemeTokens,
} from "../themes";
import type { ChartThemeTokens } from "../store/settingsStore";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHORT_HEX_RE = /^#[0-9a-fA-F]{3}$/;

const CHART_KEYS: Array<keyof ChartThemeTokens> = [
  "chart-bg",
  "chart-node-bg",
  "chart-node-border",
  "chart-edge",
  "chart-text",
];

const THEME_KEYS: Array<keyof ThemeTokens> = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "border",
  "ring",
  "error",
  "error-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "info",
  "info-foreground",
  "chart-bg",
  "chart-node-bg",
  "chart-node-border",
  "chart-edge",
  "chart-text",
];

function stripFence(text: string) {
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

function stripJsonComments(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

function parseJsonObject(text: string) {
  const raw = stripJsonComments(stripFence(text));
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("The model did not return JSON.");
  }
}

function assertHex(value: unknown, key: string): string {
  if (typeof value === "string" && HEX_RE.test(value))
    return value.toUpperCase();
  if (typeof value === "string" && SHORT_HEX_RE.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  throw new Error(`Invalid color for ${key}. Expected #RRGGBB.`);
}

function readChartTokens(obj: Record<string, unknown>): ChartThemeTokens {
  return Object.fromEntries(
    CHART_KEYS.map((key) => [key, assertHex(obj[key], key)]),
  ) as ChartThemeTokens;
}

function readThemeTokens(
  obj: Record<string, unknown>,
  mode: ColorMode,
): ThemeTokens {
  const section = obj[mode];
  if (!section || typeof section !== "object") {
    throw new Error(`Missing ${mode} theme colors.`);
  }
  const source = section as Record<string, unknown>;
  return Object.fromEntries(
    THEME_KEYS.map((key) => [key, assertHex(source[key], key)]),
  ) as unknown as ThemeTokens;
}

function paletteFromTokens(tokens: ThemeTokens) {
  return [
    tokens.background,
    tokens.primary,
    tokens.secondary,
    tokens.ring,
    tokens.foreground,
  ];
}

const chartThemePrompt = `You are a senior visual designer specializing in data-visualization and diagram tools.
Your task is to generate a cohesive color palette for a flowchart canvas.
Return ONLY strict valid JSON. No markdown, no prose, no comments. Your entire response must be one JSON object.

Required JSON shape:
{
  "chart-bg": "#RRGGBB",
  "chart-node-bg": "#RRGGBB",
  "chart-node-border": "#RRGGBB",
  "chart-edge": "#RRGGBB",
  "chart-text": "#RRGGBB"
}

── PALETTE CONSTRUCTION RULES ──────────────────────────────────────────────────

1. CANVAS BACKGROUND (chart-bg)
   - This is the largest visual surface. It sets the overall mood.
   - For dark palettes: use a deep, slightly-tinted neutral (not pure black). Good starting
     points: deep slate, warm charcoal, cool dark navy, dark forest. Typical lightness: 8–16%.
   - For light palettes: use a soft, near-white with a slight tint that reflects the mood.
     Typical lightness: 94–98%.
   - Never use pure #000000 or #FFFFFF.

2. NODE BACKGROUND (chart-node-bg)
   - Must be clearly distinguishable from chart-bg without harsh contrast.
   - For dark themes: raise 6–12 lightness points above chart-bg to create elevation.
   - For light themes: lower 5–10 lightness points below chart-bg, or use a complementary tint.
   - The node-bg and chart-bg pairing should feel like a layered surface, not two random colors.

3. NODE BORDER (chart-node-border)
   - Should be 10–20 lightness points brighter than chart-node-bg in dark themes.
   - In light themes: 15–25 lightness points darker than chart-node-bg.
   - Carries the same hue or a slight accent hue.
   - Must be clearly visible against chart-bg (minimum contrast 2.5:1).

4. EDGE / CONNECTOR (chart-edge)
   - Edges are structural, not decorative. Use a mid-lightness value that is distinct from
     both chart-bg and chart-node-bg, but does not overwhelm the nodes.
   - Often shares a hue family with chart-node-border, but can be slightly more saturated.
   - Must achieve at least 2.5:1 contrast against chart-bg.

5. NODE TEXT (chart-text)
   - Must achieve WCAG AA (≥4.5:1) against chart-node-bg.
   - Must also be readable (≥3:1) against chart-bg for labels that sit outside nodes.
   - In dark themes: near-white with a slight warm or cool cast matching the palette hue.
   - In light themes: near-black with a matching tint.

── DESIGN QUALITY STANDARDS ────────────────────────────────────────────────────

- All five colors must feel like they belong to the same palette family.
- Use a consistent hue or hue family across all tokens — avoid mixing warm and cool tones
  unless intentionally requested.
- Unless the user explicitly asks for vivid, neon, playful, or saturated colors, keep
  saturation restrained (5–30% for backgrounds, up to 50% for borders/edges).
- Avoid pure greys (0% saturation) — a small hue injection (2–8%) adds depth and personality.
- Test the mental model: imagine a node floating on the canvas. Border visible? Text readable?
  Canvas clearly behind the node? If yes, the palette works.
- If the user supplies specific hex colors, anchor those in the most appropriate role and
  derive the remaining tokens harmoniously around them.`;

const appThemePrompt = `You are a senior product designer and color systems expert.
Your task is to design a complete application theme for a desktop flowchart tool — all UI surfaces,
typography, interactive states, semantic colors, and the embedded flowchart canvas.
Return ONLY strict valid JSON. No markdown, no prose, no comments. Your entire response must be one JSON object.

Required JSON shape:
{
  "name": "Theme Name",
  "dark": {
    "background": "#RRGGBB",
    "foreground": "#RRGGBB",
    "primary": "#RRGGBB",
    "primary-foreground": "#RRGGBB",
    "secondary": "#RRGGBB",
    "secondary-foreground": "#RRGGBB",
    "muted": "#RRGGBB",
    "muted-foreground": "#RRGGBB",
    "border": "#RRGGBB",
    "ring": "#RRGGBB",
    "error": "#RRGGBB",
    "error-foreground": "#RRGGBB",
    "success": "#RRGGBB",
    "success-foreground": "#RRGGBB",
    "warning": "#RRGGBB",
    "warning-foreground": "#RRGGBB",
    "info": "#RRGGBB",
    "info-foreground": "#RRGGBB",
    "chart-bg": "#RRGGBB",
    "chart-node-bg": "#RRGGBB",
    "chart-node-border": "#RRGGBB",
    "chart-edge": "#RRGGBB",
    "chart-text": "#RRGGBB"
  },
  "light": { "same keys as dark": "#RRGGBB" }
}

── NAMING ───────────────────────────────────────────────────────────────────────

Give the theme a specific, evocative name that reflects its visual personality.
Examples: "Obsidian", "Ash Dusk", "Nordic Frost", "Copper Mine", "Sage Studio".
Avoid generic names like "Custom Theme" or "Dark Blue".

── PALETTE ARCHITECTURE ─────────────────────────────────────────────────────────

Choose a base hue family first (e.g. warm slate, cool teal, desaturated violet, sandy beige).
Every color in the theme should share a relationship with this base hue unless it is a
semantic color (error/success/warning/info). This creates cohesion.

DARK MODE — Surface Stack
  background:          The outermost app shell. Deep, slightly-tinted neutral. Lightness 8–14%.
                       Never pure black. The hue sets the mood of the entire theme.
  secondary:           Raised surface for panels, sidebars, cards. +6–10L above background.
  primary:             Interactive surface / input background. +2–5L above secondary.
                       May carry a mild accent tint. NOT the same as an accent color.
  muted:               Subtle, low-emphasis background for badges, tags. Between secondary and primary.
  border:              Thin separators. Slightly lighter than secondary, same hue.
  ring:                Focus/active indicator. Can be more saturated — this is where accent lives.
                       Should be the most visually distinct color in the UI palette.

DARK MODE — Typography
  foreground:          Primary text. Near-white with the palette hue tint. Contrast ≥7:1 on background.
  primary-foreground:  Text on primary surface. High contrast vs primary.
  secondary-foreground:Text on secondary. High contrast vs secondary.
  muted-foreground:    De-emphasized text. Readable but clearly secondary. Contrast ≥4.5:1 on background.

DARK MODE — Semantic Colors
  error:               Deep/muted red, not pure #FF0000. Contrast vs background ≥3:1.
  error-foreground:    Text on error surface. Typically near-white or light warm. Contrast ≥4.5:1 on error.
  success:             Deep/muted green. Contrast vs background ≥3:1.
  success-foreground:  Text on success surface. Contrast ≥4.5:1 on success.
  warning:             Deep/muted amber-orange. Contrast vs background ≥3:1.
  warning-foreground:  Text on warning. Contrast ≥4.5:1 on warning.
  info:                Deep/muted blue or cyan. Contrast vs background ≥3:1.
  info-foreground:     Text on info. Contrast ≥4.5:1 on info.

DARK MODE — Chart Canvas (embedded in the app)
  chart-bg:            Canvas background. 1–3 lightness steps below "background" to feel recessed.
                       The chart canvas should feel like a viewport "into" the content.
  chart-node-bg:       Node fill. Elevated above chart-bg by 8–14L steps. Should match the
                       app's surface palette — nodes feel "material", not foreign.
  chart-node-border:   Node stroke. 10–20L above chart-node-bg, same hue family.
  chart-edge:          Connector lines. Distinct from chart-bg, not overwhelming. Same hue family.
  chart-text:          Text inside nodes. Contrast ≥4.5:1 on chart-node-bg.

LIGHT MODE — Mirror the Dark Mode personality, not its values.
  background:          Near-white, 94–98L, carrying the hue tint.
  secondary:           Slightly darker than background, same hue. 88–93L.
  primary:             Input/interactive surface. 82–88L, same hue.
  muted:               Soft tint surface. Between secondary and primary.
  border:              Medium-lightness separator. Clearly visible.
  ring:                Same accent as dark mode — the accent must be recognizable in both modes.
  foreground:          Near-black with hue tint. Contrast ≥7:1 on background.
  primary-foreground, secondary-foreground, muted-foreground: mirror contrast requirements.
  Semantic colors:     Lighter, more saturated variants of the dark mode semantics (swap bg/fg roles).
  chart-bg:            Slightly darker than background (feels inset). 86–92L.
  chart-node-bg:       White or near-white. 96–100L. Clearly above chart-bg.
  chart-node-border:   Medium-lightness. Clearly visible against chart-node-bg and chart-bg.
  chart-edge:          Clearly visible against chart-bg. Mid-dark with hue tint.
  chart-text:          Near-black. Contrast ≥4.5:1 on chart-node-bg.

── DESIGN QUALITY STANDARDS ────────────────────────────────────────────────────

- Dark and light modes must feel like two expressions of the same theme, not two separate themes.
  The hue, ring color, and semantic palette should be recognizable in both modes.
- Unless the user explicitly requests vivid, neon, playful, or saturated colors, keep saturation
  restrained. Backgrounds: 3–15% saturation. Accent/ring: up to 60%.
- Never use pure greys (#808080, #000000, #FFFFFF) — a small hue injection creates depth.
- Semantic colors (error/success/warning/info) should look intentional but not garish.
  Typical dark mode semantics: #7B2D2D (error), #2D5C3D (success), #6B4F1A (warning), #1E4A6B (info).
  Light mode: much lighter backgrounds with high-contrast foreground text.
- If the user provides specific hex values, anchor those in the most logical role and derive
  the remaining tokens harmoniously. Do not discard user-provided colors.
- Avoid color combinations that could be confused by common color-vision deficiencies
  (red-green, blue-yellow). Use lightness contrast as the primary differentiator.`;

function parsedThemeToTheme(parsed: Record<string, unknown>): Theme {
  const dark = readThemeTokens(parsed, "dark");
  const light = readThemeTokens(parsed, "light");
  const name =
    typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim().slice(0, 32)
      : "Custom Theme";

  return {
    name,
    palette: paletteFromTokens(dark),
    dark,
    light,
  };
}

async function completeJsonWithRetries<T>(
  tag: string,
  systemPrompt: string,
  userPrompt: string,
  parse: (raw: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  let lastRaw = "";
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content:
          attempt === 0
            ? userPrompt
            : `Your previous response failed this JSON-only request.

Validation error:
${lastError instanceof Error ? lastError.message : String(lastError)}

Previous response:
${lastRaw}

Retry now. Return ONLY one strict valid JSON object matching the required schema. No markdown, prose, comments, or code fences.

Original user request:
${userPrompt}`,
      },
    ];

    lastRaw = await completeLLM(systemPrompt, messages, signal);
    console.log(
      `[theme:${tag}] raw model output${attempt > 0 ? ` retry ${attempt}` : ""}:`,
      lastRaw,
    );

    try {
      return parse(lastRaw);
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        console.warn(
          `[theme:${tag}] JSON parse failed; retrying (${attempt + 1}/2):`,
          err,
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The model did not return valid JSON.");
}

export async function generateChartThemeFromPrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<ChartThemeTokens> {
  console.log("[theme:chart] prompt:", prompt);
  const tokens = await completeJsonWithRetries(
    "chart",
    chartThemePrompt,
    prompt,
    (raw) => readChartTokens(parseJsonObject(raw)),
    signal,
  );
  console.log("[theme:chart] parsed tokens:", tokens);
  return tokens;
}

export async function generateAppThemeFromPrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<Theme> {
  console.log("[theme:app] prompt:", prompt);
  const theme = await completeJsonWithRetries(
    "app",
    appThemePrompt,
    prompt,
    (raw) =>
      parsedThemeToTheme(parseJsonObject(raw) as Record<string, unknown>),
    signal,
  );
  console.log("[theme:app] parsed theme:", theme);
  return theme;
}

export function resetChartThemeTokens(themeKey: string, mode: ColorMode) {
  return themes[themeKey]?.[mode] ?? themes.raven.dark;
}
