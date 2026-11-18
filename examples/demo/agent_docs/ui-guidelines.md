# UI guidelines

Target feel: a polished developer documentation / demo site, not a SaaS dashboard.

## Visual

- Prioritize clarity, hierarchy, consistent spacing, obvious actions, clear status.
- Avoid heavy animations, gradients, shadows, modals and decorative elements.
- No UI framework: plain CSS, following the existing styles in `src/app/app.css`.

## Accessibility

- Semantic HTML, keyboard-accessible controls, visible focus states, meaningful labels.
- Sufficient contrast.
- Announce status changes accessibly (e.g. `role="status"` / `aria-live`).
- Never convey state only through color or animation: always add text.

## Responsive

- Must work on desktop, tablet and mobile.
- Code blocks may scroll horizontally on small screens rather than wrap unreadably.
