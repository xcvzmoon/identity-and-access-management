<script setup lang="ts">
  import * as valibot from 'valibot';
  import { organizationsSchema } from '~/utils/management';

  useHead({ title: 'Organizations · IAM console' });

  const FIRST_ORGANIZATION = 0;
  const selected = ref('');
  const { data, error, refresh } = await useAsyncData(
    'management-organizations',
    async () => {
      const result = await $fetch('/api/v1/management', {
        method: 'POST',
        body: { action: 'list' },
      });

      return valibot.parse(organizationsSchema, result).organizations;
    },
    { server: false },
  );
  const organization = computed(
    () => data.value?.find(({ id }) => id === selected.value) ?? data.value?.at(FIRST_ORGANIZATION),
  );
  const { data: session } = await useFetch('/api/v1/session', {
    server: false,
    cache: 'no-store',
    transform: (response) =>
      valibot.parse(
        valibot.object({
          user: valibot.object({ sub: valibot.string() }),
          issuer: valibot.pipe(valibot.string(), valibot.startsWith('https://'), valibot.url()),
        }),
        response,
      ),
  });

  function selectOrganization(event: Event): void {
    if (event.target instanceof HTMLSelectElement) {
      selected.value = event.target.value;
    }
  }
</script>

<template>
  <section class="grid gap-6">
    <NuxtLink
      to="/account"
      class="text-primary"
    >
      Your account
    </NuxtLink>
    <h1 class="text-3xl font-semibold">Organizations</h1>
    <div
      v-if="error"
      role="alert"
      class="grid justify-items-start gap-2"
    >
      <p>Unable to load your organizations.</p>
      <UButton
        href="/api/v1/login?returnTo=/management"
        external
      >
        Sign in again
      </UButton>
      <UButton
        variant="link"
        @click="refresh()"
      >
        Retry
      </UButton>
    </div>
    <template v-else-if="organization">
      <label
        v-if="data && data.length > 1"
        class="grid gap-1"
      >
        Organization
        <select
          class="rounded border border-default bg-default p-2"
          :value="organization.id"
          @change="selectOrganization"
        >
          <option
            v-for="entry in data"
            :key="entry.id"
            :value="entry.id"
          >
            {{ entry.name }}
          </option>
        </select>
      </label>
      <h2 class="text-xl font-semibold">{{ organization.name }}</h2>
      <a
        v-if="session"
        class="text-primary underline"
        :href="session.issuer + '/passkeys'"
        target="_blank"
        rel="noopener noreferrer"
      >
        Verify with a passkey (opens a new tab)
      </a>
      <OrganizationManagement
        v-if="session"
        :actor-id="session.user.sub"
        :actor-role="organization.role"
        :key="organization.id"
        :organization-id="organization.id"
        @renamed="refresh()"
      />
    </template>
    <p v-else-if="data">You have no organizations to manage.</p>
    <p
      v-else
      role="status"
    >
      Loading organizations…
    </p>
  </section>
</template>
