<script setup lang="ts">
  useHead({ title: 'Signed out · IAM console' });
</script>

<template>
  <section class="grid justify-items-start gap-6 border-t-2 border-primary pt-6">
    <h1 class="text-3xl font-semibold tracking-tight">Signed out of the console</h1>
    <UButton
      href="/api/v1/login?returnTo=%2Faccount"
      external
    >
      Sign in again
    </UButton>
  </section>
</template>
