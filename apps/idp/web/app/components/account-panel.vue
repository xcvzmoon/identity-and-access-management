<script setup lang="ts">
  type Props = { title: string; description?: string };

  const props = defineProps<Props>();

  useHead(() => ({ title: props.title }));
</script>

<template>
  <section
    class="w-full min-w-0 max-w-md rounded-xl border border-muted bg-default"
    aria-labelledby="account-heading"
  >
    <div
      class="flex items-center gap-2.5 border-b border-muted px-6 py-4 text-sm font-semibold text-highlighted sm:px-8"
    >
      <span class="grid size-8 place-items-center rounded-lg bg-inverted text-inverted">
        <UIcon
          name="i-lucide-shield-check"
          class="size-4"
          aria-hidden="true"
        />
      </span>
      IAM
    </div>
    <div class="grid min-w-0 gap-6 p-6 sm:p-8">
      <div class="grid gap-2">
        <h1
          id="account-heading"
          class="break-words text-3xl font-semibold tracking-tight text-balance"
        >
          {{ title }}
        </h1>
        <p
          v-if="description"
          class="text-sm leading-relaxed text-muted"
        >
          {{ description }}
        </p>
      </div>
      <slot />
    </div>
  </section>
</template>
