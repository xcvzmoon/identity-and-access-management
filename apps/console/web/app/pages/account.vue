<script setup lang="ts">
  import * as valibot from 'valibot';

  definePageMeta({ alias: '/' });
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
    class="grid gap-6 border-t-2 border-primary pt-6"
    aria-labelledby="account-title"
  >
    <h1
      id="account-title"
      class="text-3xl font-semibold tracking-tight"
    >
      Your account
    </h1>
    <template v-if="session">
      <dl class="grid gap-4">
        <div v-if="session.user.name">
          <dt class="text-sm text-muted">Name</dt>
          <dd>{{ session.user.name }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Email address</dt>
          <dd class="break-words">{{ session.user.email }}</dd>
        </div>
      </dl>
      <div>
        <UButton
          :href="`${session.issuer}/forgot-password`"
          variant="link"
        >
          Reset password
        </UButton>
      </div>
      <NuxtLink
        to="/management"
        class="text-primary underline"
      >
        Manage organizations
      </NuxtLink>
      <section
        class="grid gap-3 border-t border-default pt-6"
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
