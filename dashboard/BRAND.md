# ClawMon Brand Kit

> Crypto-economically secured trust registry for MCP skills, built on ERC-8004 + Monad.

---

## 1. Brand Identity

**Positioning:** Infrastructure-grade trust layer for the AI agent ecosystem.
Think Coinbase/Base credibility meets DeFi-infra functionality. Not a meme project —
this is serious security infrastructure that catches sybil rings and punishes bad actors.

**Tone:** Authoritative, technical, trustworthy. Minimal marketing fluff.
Data speaks for itself. The brand communicates precision and reliability.

**Logo:** ClawMon mascot (lobster claw) + wordmark in Inter 700.

---

## 2. Color Palette

### Primary

| Token               | Hex       | HSL                  | Usage                        |
|----------------------|-----------|----------------------|------------------------------|
| `--color-accent`     | `#c45c3a` | `hsl(14, 55%, 50%)`  | Primary CTA, active states   |
| `--color-accent-hover` | `#d4654a` | `hsl(14, 60%, 56%)` | Hover variant                |
| `--color-accent-muted` | `#c45c3a33` | —               | Glows, selection, subtle bg  |

### Surfaces (Dark Mode — Default)

| Token              | Hex       | HSL                   | Usage                  |
|---------------------|-----------|----------------------|------------------------|
| `--color-surface-0` | `#0f0d0b` | `hsl(30, 15%, 4%)`  | Page background        |
| `--color-surface-1` | `#161311` | `hsl(24, 12%, 7%)`  | Header, footer, panels |
| `--color-surface-2` | `#1c1916` | `hsl(28, 10%, 10%)` | Cards, sections        |
| `--color-surface-3` | `#252019` | `hsl(28, 17%, 12%)` | Hover states on cards  |

### Borders

| Token                  | Hex       | Usage             |
|------------------------|-----------|-------------------|
| `--color-border`       | `#2e2821` | Default borders   |
| `--color-border-hover` | `#3d342b` | Hover borders     |

### Text

| Token                    | Hex       | WCAG on Surface-0 | Usage             |
|--------------------------|-----------|-------------------|-------------------|
| `--color-text-primary`   | `#ede5dd` | 14.8:1 AAA        | Headings, body    |
| `--color-text-secondary` | `#a09688` | 6.2:1 AA          | Descriptions      |
| `--color-text-muted`     | `#6b5f54` | 3.1:1 (large AA)  | Labels, captions  |

### Status / Semantic

| Token              | Hex       | Usage              |
|---------------------|-----------|-------------------|
| `--color-success`  | `#4ade80` | Verified, positive |
| `--color-warning`  | `#f59e0b` | Stale, caution     |
| `--color-danger`   | `#ef4444` | Malicious, slashed |
| `--color-info`     | `#60a5fa` | Links, info badges |

### Trust Tier Colors

| Tier  | Color     | Band     |
|-------|-----------|----------|
| AAA   | `#16a34a` | Premium  |
| AA    | `#22c55e` | Premium  |
| A     | `#4ade80` | Premium  |
| BBB   | `#facc15` | Standard |
| BB    | `#f59e0b` | Standard |
| B     | `#f97316` | Standard |
| CCC   | `#ef4444` | Budget   |
| CC    | `#dc2626` | Budget   |
| C     | `#991b1b` | Budget   |

### Protocol Colors

| Token              | Hex       | Usage             |
|---------------------|-----------|-------------------|
| `--color-staking`  | `#8b5cf6` | Staking / bonded  |
| `--color-tee`      | `#06b6d4` | TEE attestation   |
| `--color-monad`    | `#836EF9` | Monad chain       |

---

## 3. Typography

### Font Stack

| Role     | Family                  | Weights Used    |
|----------|-------------------------|-----------------|
| Primary  | Inter                   | 400, 500, 600, 700, 800 |
| Mono     | JetBrains Mono          | 400, 500, 600, 700      |

### Type Scale

| Element          | Size      | Weight | Tracking     | Font    |
|------------------|-----------|--------|--------------|---------|
| Page title       | 2.8rem    | 800    | -0.03em      | Inter   |
| Section heading  | 1.5rem    | 700    | -0.02em      | Inter   |
| Card title       | 1rem      | 700    | 0            | Inter   |
| Body text        | 0.9rem    | 400    | 0            | Inter   |
| Small / caption  | 0.75rem   | 500    | 0.02em       | Inter   |
| Label (uppercase)| 0.72rem   | 600–700| 0.06em       | Inter   |
| Monospace value  | 0.85rem   | 600–700| -0.02em      | JetBrains Mono |
| Stat number      | 1.4–1.8rem| 700–800| -0.02em      | JetBrains Mono |

### Rules

- All headings: Inter, left-aligned, negative tracking
- All numeric data: JetBrains Mono (scores, ETH values, counts, addresses)
- Labels/badges: uppercase, wide tracking (0.06em)
- Line height: 1.5 for body, 1.15 for display headings
- Max content width: 1280px

---

## 4. Spacing & Layout

| Token   | Value | Usage                      |
|---------|-------|----------------------------|
| xs      | 4px   | Inline gaps                |
| sm      | 8px   | Badge padding, tight gaps  |
| md      | 16px  | Card padding, section gaps |
| lg      | 24px  | Section padding            |
| xl      | 48px  | Between major sections     |

- Page max-width: `1280px`, centered
- Page horizontal padding: `24px`
- Header height: `56px`, sticky

---

## 5. Border Radius

| Token         | Value  | Usage                    |
|---------------|--------|--------------------------|
| `--radius-sm` | 4px    | Badges, small chips      |
| `--radius-md` | 6px    | Buttons, inputs          |
| `--radius-lg` | 8px    | Cards, panels, nav items |
| `--radius-xl` | 12px   | Large containers, modals |

**Rule:** Never exceed 12px radius. No pill shapes except category pills
(which use 20px). No heavy rounded corners that signal "toy" UI.

---

## 6. Component Patterns

### Buttons

- Primary: `bg-accent`, white text, `radius-md`, 600 weight
- Secondary: transparent bg, border, text-secondary
- Destructive: transparent bg, danger border, danger text
- All buttons: `font-family: inherit`, no uppercase

### Cards

- `bg-card`, `1px solid border`, `radius-xl` (12px)
- Padding: `20px`
- Hover: `border-hover`, subtle translateY(-2px), box-shadow
- Score bar at bottom: 3px height, full-width, color-coded

### Badges

- Compact: 2px 8px padding, radius-sm, 0.65rem, 600 weight
- Border: 1px solid with 25% opacity of the badge color
- Background: 12% opacity of the badge color
- Status colors: success (green), danger (red), warning (orange), info (blue)

### Tables

- Header: bg-secondary, uppercase 0.72rem labels
- Rows: clickable, hover bg-card-hover
- Flagged rows: 3px left border in danger/warning color
- Monospace columns: scores, stakes, counts

### Slide-over Panel

- Width: 560px, max 100vw
- Background: bg-secondary
- Shadow: -8px 0 40px rgba(0,0,0,0.4)
- Animation: slide-in from right 0.25s ease

---

## 7. Animation Guidelines

- **Transitions:** 0.15s for micro (hover, focus), 0.25s for panels
- **Easing:** `ease` for most, `ease-out` for entrances
- **Allowed animations:**
  - Fade-in (opacity 0 → 1)
  - Slide-in (translateX/Y for panels)
  - Subtle scale on stat updates (1 → 1.05 → 1)
  - Pulsing dot for live indicators
  - Score bar width transitions (0.6s ease)
- **Forbidden:**
  - Particle effects
  - Continuous rotation (except loading spinners)
  - Bounce/elastic easing
  - Animations > 0.6s duration (except live pulse)

---

## 8. Do's and Don'ts

### Do

- Use generous whitespace between sections
- Keep data dense in tables, spacious in cards
- Use JetBrains Mono for ALL numeric values
- Use status colors consistently (green = good, red = bad)
- Maintain high contrast: text-primary on surface-0 = 14.8:1
- Left-align text (except stat values in cards, which center)
- Use lucide-react icons (stroke-width 1.5–2)

### Don't

- Use emojis in UI text
- Use gradients (except subtle brand gradient for featured elements)
- Use border-radius > 12px on containers
- Use more than 4 colors in a single view
- Use box-shadow > `0 4px 24px rgba(0,0,0,0.3)`
- Use font sizes below 0.62rem
- Use more than 2 font families
- Use inline styles for colors (use CSS variables)
- Use placeholder/lorem ipsum content
- Use heavy glassmorphism or neumorphism

---

## 9. Tailwind Integration

Design tokens are defined in `src/styles/tokens.css` using Tailwind v4's
`@theme` directive. This generates both CSS custom properties and Tailwind
utility classes automatically.

```css
/* Example usage in components */
<div className="bg-surface-2 border border-border rounded-xl p-5">
  <h3 className="text-text-primary font-bold text-base tracking-tight">
    Card Title
  </h3>
  <p className="text-text-secondary text-sm mt-2">
    Description text here.
  </p>
</div>
```

Legacy CSS custom properties (`--bg-primary`, `--accent`, etc.) remain
available via the compatibility layer in `tokens.css` for existing
component styles in `App.css`.

---

## 10. File Structure

```
dashboard/
├── src/
│   ├── styles/
│   │   └── tokens.css        # Design tokens (@theme + legacy vars)
│   ├── App.css               # Component styles (uses legacy vars)
│   ├── components/           # React components
│   └── ...
├── BRAND.md                  # This file
└── index.html                # Font imports (Inter + JetBrains Mono)
```
