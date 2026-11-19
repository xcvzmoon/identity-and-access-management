<script setup lang="ts">
  const route = useRoute();
  const href = ref('');

  function readLocation(): void {
    href.value = globalThis.location.href;
  }

  onMounted(() => {
    readLocation();
    globalThis.addEventListener('hashchange', readLocation);
  });

  onBeforeUnmount(() => globalThis.removeEventListener('hashchange', readLocation));

  watch(() => route.fullPath, readLocation);

  const invitation = computed(() => {
    if (!href.value) {
      return;
    }

    const url = new URL(href.value);
    const fragment = new URLSearchParams(url.hash.replace(/^#/u, ''));

    return {
      token: fragment.get('token') ?? url.searchParams.get('token') ?? '',
      verified: fragment.get('verified') === '1',
    };
  });
</script>

<template>
  <InvitationForm
    v-if="invitation?.token"
    :key="href"
    :token="invitation.token"
    :verified="invitation.verified"
  />
  <AccountPanel
    v-else
    title="Join your organization"
  >
    <p
      v-if="invitation"
      role="alert"
    >
      Open the link in your invitation email.
    </p>
  </AccountPanel>
</template>
