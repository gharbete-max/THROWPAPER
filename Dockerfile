# Formwork — one image containing the API and the built app.
#
# Chromium is a hard requirement, not an optimisation: phase 4a renders admission PDFs through
# Playwright, so a slim Node base would produce an image that boots happily and then fails the
# first time somebody asks for a document. The Playwright base image carries the browser and its
# system libraries at matching versions, which is the part that is painful to assemble by hand.
#
# Build:  docker build -t formwork .
# Run:    docker run -p 4001:4001 -e DATABASE_URL=... -e JWT_SECRET=... formwork
# Demo:   docker run -p 4001:4001 -e DEMO=true formwork

# Keep this in step with the playwright version in package.json — a mismatch between the browser
# in the image and the client driving it fails at runtime, not at build time.
ARG PLAYWRIGHT_VERSION=v1.62.1

# --- build -------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-noble AS build

WORKDIR /app
ENV CI=true

RUN corepack enable

# Manifests first, so a dependency install is only redone when dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api-forms/package.json apps/api-forms/
COPY apps/api-mailer/package.json apps/api-mailer/
COPY apps/forms/package.json apps/forms/
COPY apps/mailer/package.json apps/mailer/
COPY packages/calc/package.json packages/calc/
COPY packages/i18n/package.json packages/i18n/
COPY packages/shared/package.json packages/shared/
COPY packages/tokens/package.json packages/tokens/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @tp/forms build

# --- runtime -----------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}-noble AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV API_FORMS_PORT=4001
# The API serves the built app too, so one container is the whole product.
ENV SERVE_APP=/app/apps/forms/dist
ENV DOCUMENT_DIR=/app/.documents

RUN corepack enable

COPY --from=build /app /app

# Generated documents are written here. A named volume keeps a bulk export alive across restarts;
# without one they vanish, which is acceptable for a demo and not for production.
VOLUME ["/app/.documents"]

EXPOSE 4001

# The Playwright image runs as root by default; drop to the user it already provides.
USER pwuser

# `DEMO=true` starts the in-memory build — no database, mail never sent. Anything else starts the
# real server, which refuses to boot without JWT_SECRET.
CMD ["sh", "-c", "if [ \"$DEMO\" = \"true\" ]; then pnpm --filter @tp/api-forms exec tsx src/demo/main.ts; else pnpm --filter @tp/api-forms exec tsx src/main.ts; fi"]
