<script setup lang="ts">
  definePageMeta({ auth: 'user' });

  const app = useNuxtApp();
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);

  async function signOut(): Promise<void> {
    pending.value = true;
    error.value = null;
    try {
      const result = await app.$auth.signOut();
      if (result.error) {
        error.value = result.error.message ?? 'Sign out failed.';
        return;
      }
      await app.$refreshAuthSession();
      await navigateTo('/signin');
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
        Welcome, {{ app.$authUser.value?.name }}
      </h1>
    </header>

    <p class="text-muted">{{ app.$authUser.value?.email }}</p>

    <UAlert
      v-if="error"
      :description="error"
      color="error"
      role="alert"
      title="Sign out failed"
    />

    <UButton
      :loading="pending"
      label="Sign out"
      class="self-start"
      @click="signOut"
    />
  </main>
</template>
