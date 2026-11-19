<script setup lang="ts">
  type Props = { title: string };

  const props = defineProps<Props>();

  useHead(() => ({ title: props.title }));
</script>

<template>
  <section
    class="border-t-2 border-primary pt-6"
    aria-labelledby="account-heading"
  >
    <h1
      id="account-heading"
      class="mb-6 text-3xl font-semibold tracking-tight"
    >
      {{ title }}
    </h1>
    <slot />
  </section>
</template>
