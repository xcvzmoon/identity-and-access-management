<script setup lang="ts">
  useHead({ title: 'Signed out · IAM console' });
</script>

<template>
  <section class="grid justify-items-center gap-5 text-center">
    <UIcon
      name="i-lucide-shield-check"
      class="size-10 text-muted"
    />
    <h1 class="text-3xl font-semibold tracking-tight">Signed out of the console</h1>
    <UButton
      href="/api/v1/login?returnTo=%2Fdashboard"
      external
    >
      Sign in again
    </UButton>
  </section>
</template>
