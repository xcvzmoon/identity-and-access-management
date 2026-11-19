<script setup lang="ts">
  const signedOut = ref(false);
  const { error, pending, submit } = useAccountAction();

  async function signOut(): Promise<void> {
    await submit(async () => {
      await $fetch('/api/v1/auth/sign-out', {
        method: 'POST',
        body: {},
      });
      signedOut.value = true;
    }, 'Unable to sign out of IAM. Try again.');
  }
</script>

<template>
  <AccountPanel title="Sign out of IAM">
    <div class="grid gap-4">
      <template v-if="signedOut">
        <p role="status">You have signed out of IAM.</p>
        <NuxtLink to="/sign-in">Sign in again</NuxtLink>
      </template>

      <template v-else>
        <p>End your IAM session on this browser? Apps using this session will lose access.</p>
        <UButton
          :loading="pending"
          label="Sign out of IAM"
          @click="signOut"
        />
        <p
          v-if="error"
          role="alert"
        >
          {{ error }}
        </p>
      </template>
    </div>
  </AccountPanel>
</template>
