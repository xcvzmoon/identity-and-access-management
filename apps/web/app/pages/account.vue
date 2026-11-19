<script setup lang="ts">
  definePageMeta({ auth: 'user' });

  const userSession = useUserSession();
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);

  async function signOut(): Promise<void> {
    pending.value = true;
    error.value = null;

    try {
      await $fetch('/api/signout', {
        method: 'POST',
        body: {},
      });
      userSession.clear();
      await navigateTo('/signin', { external: true });
    } catch {
      error.value = 'Sign out failed.';
    } finally {
      pending.value = false;
    }
  }
</script>

<template>
  <main class="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12">
    <header>
      <p class="mb-3 text-xs tracking-widest text-muted uppercase">Your account</p>

      <h1 class="text-3xl font-semibold tracking-tight">
        Welcome, {{ userSession.user.value?.name }}
      </h1>
    </header>

    <p class="text-muted">{{ userSession.user.value?.email }}</p>

    <p
      v-if="userSession.user.value?.emailVerified"
      class="text-sm text-muted"
      role="status"
    >
      Email verified
    </p>
    <NuxtLink
      v-else
      to="/recover-password"
      external
      class="text-primary underline underline-offset-4"
    >
      Verify your email and set your password
    </NuxtLink>

    <AccountInvitations v-if="userSession.user.value?.emailVerified" />

    <UAlert
      v-if="error"
      :description="error"
      color="error"
      role="alert"
    />

    <UButton
      :loading="pending"
      label="Sign out"
      class="self-start"
      @click="signOut"
    />
  </main>
</template>
