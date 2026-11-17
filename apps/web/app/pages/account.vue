<script setup lang="ts">
  definePageMeta({ auth: 'user' });

  const userSession = useUserSession();
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);

  async function signOut(): Promise<void> {
    pending.value = true;
    error.value = null;
    try {
      await $fetch('/api/signout', { method: 'POST' });
      userSession.session.value = null;
      await navigateTo('/signin');
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
