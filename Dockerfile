# syntax=docker/dockerfile:1
FROM node:26.13.0-bookworm-slim AS base
WORKDIR /app

FROM base AS dependencies
RUN npm install --global pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/idp/api/package.json apps/idp/api/
COPY apps/idp/web/package.json apps/idp/web/
COPY apps/console/api/package.json apps/console/api/
COPY apps/console/web/package.json apps/console/web/
COPY examples/reference-app/package.json examples/reference-app/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

FROM dependencies AS build
ARG WORKSPACE
COPY tsconfig.json ./
COPY shared shared/
COPY apps apps/
WORKDIR /app/apps/${WORKSPACE}
RUN if [ -f .env.example ]; then \
      sed 's/=""$/="unused-build-time-value-00000000000000000000"/; s/^OPERATOR_USER_IDS=.*/OPERATOR_USER_IDS=""/' .env.example > .env; \
    fi \
    && pnpm run build

FROM base AS runtime
ARG WORKSPACE
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
LABEL org.opencontainers.image.source="https://github.com/xcvzmoon/identity-and-access-management"
COPY --link --from=build /app/apps/${WORKSPACE}/.output ./.output
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
