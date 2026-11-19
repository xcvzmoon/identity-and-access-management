<script setup lang="ts">
  import * as valibot from 'valibot';

  const clientSchema = valibot.object({
    name: valibot.pipe(valibot.string(), valibot.nonEmpty()),
  });

  definePageMeta({ key: (route) => route.fullPath });

  const route = useRoute();
  const { webOrigin } = useRuntimeConfig().public;
  const webApi = useWebApi();
  if (route.path !== '/oidc/login' && route.path !== '/oidc/consent') {
    throw createError({
      status: 404,
      message: 'Page not found',
    });
  }

  const signedRequest = new URL(route.fullPath, 'https://iam.invalid').searchParams.toString();
  const { data: client, status } = await useAsyncData(
    `oidc-client-${signedRequest}`,
    async () => {
      const response = await webApi<unknown>('/api/oidc/client', {
        query: { request: signedRequest },
        retry: 0,
      });

      return valibot.parse(clientSchema, response);
    },
    { server: false },
  );

  const signingIn = route.path === '/oidc/login';
  const step = signingIn ? 'login' : 'consent';
  const formAction = new URL(`/api/oidc/${step}`, webOrigin).href;
  useHead({ title: signingIn ? 'Sign in' : 'Confirm application access' });
</script>

<template>
  <main
    v-if="client"
    class="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12"
  >
    <header class="space-y-3">
      <h1 class="text-3xl font-semibold tracking-tight">
        {{ signingIn ? 'Sign in' : 'Confirm application access' }}
      </h1>

      <p class="text-sm text-muted">
        {{ signingIn ? 'Continue to' : 'Share your account identifier with' }}
        <strong class="break-words text-default">{{ client.name }}</strong>
        .
      </p>
    </header>

    <form
      :action="formAction"
      method="post"
      class="space-y-5"
    >
      <input
        :value="signedRequest"
        type="hidden"
        name="oauth_query"
      />

      <template v-if="signingIn">
        <UFormField
          label="Email"
          name="email"
          required
        >
          <UInput
            name="email"
            type="email"
            autocomplete="email"
            class="w-full"
            required
          />
        </UFormField>

        <UFormField
          label="Password"
          name="password"
          required
        >
          <UInput
            name="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            required
          />
        </UFormField>

        <UButton
          label="Sign in"
          type="submit"
          block
        />
      </template>

      <template v-else>
        <UButton
          label="Continue"
          type="submit"
          name="intent"
          value="allow"
          block
        />

        <UButton
          label="Cancel"
          type="submit"
          name="intent"
          value="deny"
          color="neutral"
          variant="outline"
          block
        />
      </template>
    </form>

    <NuxtLink
      v-if="signingIn"
      to="/recover-password"
      class="text-sm text-primary underline underline-offset-4"
    >
      Verify your email or reset your password
    </NuxtLink>
  </main>
  <main
    v-else
    class="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center px-6 py-12"
  >
    <p
      v-if="status === 'error'"
      role="alert"
    >
      Restart sign-in from the application.
    </p>
    <p
      v-else
      role="status"
    >
      Loading sign-in details…
    </p>
  </main>
</template>
