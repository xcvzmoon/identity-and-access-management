<script setup lang="ts">
  const password = defineModel<string>('password', {
    default: 'thisisapassword_thisisapassword_thisisapassword_thisisapassword',
  });
  const show = ref<boolean>(false);
</script>

<template>
  <UInput
    v-model="password"
    :ui="{
      root: 'w-full',
      base: 'pe-8',
      trailing: 'pe-1',
    }"
    :type="show ? 'text' : 'password'"
  >
    <template #trailing>
      <UButton
        :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="show ? 'Hide password' : 'Show password'"
        :aria-pressed="show"
        color="neutral"
        variant="link"
        size="icon-sm"
        aria-controls="password"
        @click="show = !show"
      />
    </template>
  </UInput>
</template>

<style>
  /* Hide the password reveal button in Edge */
  ::-ms-reveal {
    display: none;
  }
</style>
