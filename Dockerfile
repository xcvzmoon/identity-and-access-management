# syntax=docker/dockerfile:1
FROM node:26.13.0-bookworm-slim AS base
WORKDIR /app

FROM base AS dependencies
RUN npm install --global pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

FROM dependencies AS build
COPY . .
RUN pnpm exec vp -C packages/shared run build:utils \
    && pnpm exec vp -C packages/database run build \
    && pnpm exec vp -C packages/shared run build

FROM build AS api-build
RUN pnpm exec vp -C packages/auth run build \
    && pnpm exec vp -C apps/api run build

FROM build AS web-build
RUN pnpm exec vp -C apps/web run build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
LABEL org.opencontainers.image.source="https://github.com/xcvzmoon/identity-and-access-management"
CMD ["node", ".output/server/index.mjs"]

FROM runtime AS api
COPY --link --from=api-build /app/apps/api/.output ./.output
ENV APP_ENV=production PORT=3000
EXPOSE 3000
USER node

FROM runtime AS web
COPY --link --from=web-build /app/apps/web/.output ./.output
ENV PORT=5173
EXPOSE 5173
USER node
