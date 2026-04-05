# Dashboard Frontend (src) Documentation

This folder documents the `dashboard/src` directory.

The visual dashboard is a Next.js React application using the App Router architecture. It serves as the single pane of glass for monitoring system scale, database health, and managing IP bans.

## Directory Structure
- **`app/`**: Contains the Next.js routing logic, layouts, and page definitions (e.g. the home dashboard, admin controls, and metrics pages).
- **`components/`**: Modular UI components. The presence of `components.json` indicates an external UI library is being used, likely `shadcn/ui` alongside Tailwind CSS.
- **`lib/`**: Helpers and utilities (e.g., fetching wrappers, data formatting, and shared constants) used across different pages.
- **`instrumentation.ts`**: Standard Next.js file for server-side instrumentation and boot-time setup.

## Configuration & Tooling
- The Next.js framework configuration is located in the root `next.config.ts`.
- Styling configuration is handled by `postcss.config.mjs` and standard Tailwind setups.
