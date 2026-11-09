Read .build-instructions.md first. User requirements and sourced facts take precedence. Never invent business addresses, phones, prices, reviews, awards or staff. Demo records must be explicitly requested and labelled. Use a database only when the build instructions require persistence and provide credentials. Respect explicit no-database builds. Preserve complete functionality and verify responsive UI before finishing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
