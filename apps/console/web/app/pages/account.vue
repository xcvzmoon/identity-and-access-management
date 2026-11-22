<script setup lang="ts">
  import * as valibot from 'valibot';

  useHead({ title: 'Your account · IAM console' });

  const UNAUTHORIZED = 401;

  const route = useRoute();
  const sessionSchema = valibot.object({
    issuer: valibot.pipe(valibot.string(), valibot.startsWith('https://'), valibot.url()),
    user: valibot.object({
      name: valibot.nullable(valibot.string()),
      email: valibot.string(),
      sub: valibot.string(),
    }),
  });
  const {
    data: session,
    error,
    refresh,
  } = await useFetch('/api/v1/session', {
    server: false,
    cache: 'no-store',
    transform: (response) => valibot.parse(sessionSchema, response),
  });

  watchEffect(() => {
    if (error.value?.statusCode === UNAUTHORIZED) {
      const query = new URLSearchParams({ returnTo: route.fullPath });
      globalThis.location.replace(`/api/v1/login?${query}`);
    }
  });
</script>

<template>
  <section
    class="grid max-w-4xl gap-6"
    aria-labelledby="account-title"
  >
    <h1
      id="account-title"
      class="text-3xl font-semibold tracking-tight sm:text-4xl"
    >
      Your account
    </h1>
    <template v-if="session">
      <section
        aria-label="Profile"
        class="flex items-center gap-4 rounded-lg border border-muted bg-muted p-5"
      >
        <UAvatar
          :alt="session.user.name || session.user.email"
          size="xl"
        />
        <div class="min-w-0">
          <h2 class="break-words text-xl font-semibold">
            {{ session.user.name || session.user.email }}
          </h2>
          <p
            v-if="session.user.name"
            class="break-all text-sm text-muted"
          >
            {{ session.user.email }}
          </p>
        </div>
      </section>
      <section class="grid gap-4 rounded-lg border border-muted bg-muted p-5">
        <h2 class="text-lg font-medium">Account security</h2>
        <div class="flex flex-wrap gap-3">
          <UButton
            :href="session.issuer + '/passkeys'"
            color="neutral"
            variant="outline"
          >
            Manage passkeys
          </UButton>
          <UButton
            :href="session.issuer + '/forgot-password'"
            color="neutral"
            variant="outline"
          >
            Reset password
          </UButton>
        </div>
      </section>
      <section
        class="grid gap-4 rounded-lg border border-muted bg-muted p-5 sm:p-6"
        aria-labelledby="session-title"
      >
        <h2
          id="session-title"
          class="text-lg font-semibold"
        >
          Browser session
        </h2>
        <p class="text-muted">
          Sign out of the console to keep using your other apps. Sign out of IAM to end your single
          sign-on session in this browser.
        </p>
        <div class="flex flex-wrap gap-3">
          <SessionSignOut scope="app" />
          <SessionSignOut scope="iam" />
        </div>
      </section>
    </template>
    <div
      v-else-if="error && error.statusCode !== UNAUTHORIZED"
      class="grid justify-items-start gap-3"
    >
      <p role="alert">Your account could not be loaded.</p>
      <UButton
        variant="outline"
        @click="refresh()"
      >
        Try again
      </UButton>
    </div>
    <p
      v-else
      role="status"
    >
      Opening your account…
    </p>
  </section>
</template>
