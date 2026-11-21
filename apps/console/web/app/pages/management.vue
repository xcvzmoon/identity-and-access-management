<script setup lang="ts">
  import * as valibot from 'valibot';
  import { managementSections, organizationsSchema } from '~/utils/management';

  definePageMeta({
    path: '/:section(dashboard|management|members|invitations|applications|access)',
  });

  const [overview] = managementSections;
  const route = useRoute();
  const section = computed(
    () => managementSections.find(({ to }) => to === route.path) ?? overview,
  );

  useHead(() => ({ title: `${section.value.label} · IAM console` }));

  const UNAUTHORIZED = 401;
  const FIRST_ORGANIZATION = 0;
  const selected = useState('console-organization', () => '');
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
  const organization = computed(() => {
    if (route.query.org) {
      return data.value?.find(({ id }) => id === route.query.org);
    }

    return (
      data.value?.find(({ id }) => id === selected.value) ?? data.value?.at(FIRST_ORGANIZATION)
    );
  });

  watch(
    organization,
    (current) => {
      if (current) {
        selected.value = current.id;
      }
    },
    { immediate: true },
  );

  async function switchOrganization(id: string): Promise<void> {
    selected.value = id;
    await navigateTo({
      path: route.path,
      query: { org: id },
    });
  }

  const {
    data: session,
    error: sessionError,
    refresh: refreshSession,
  } = await useFetch('/api/v1/session', {
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
  watchEffect(() => {
    if (sessionError.value?.statusCode === UNAUTHORIZED) {
      const query = new URLSearchParams({ returnTo: route.fullPath });
      globalThis.location.replace(`/api/v1/login?${query}`);
    }
  });
</script>

<template>
  <section class="grid gap-6">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b border-muted pb-4">
      <div class="min-w-0">
        <p
          v-if="organization && section.to !== '/dashboard'"
          class="mb-1 flex items-center gap-2 text-sm text-muted"
        >
          <UIcon name="i-lucide-building-2" />
          {{ organization.name }}
        </p>
        <h1
          v-if="section.to !== '/applications' || !route.query.client"
          class="text-xl font-semibold tracking-tight sm:text-2xl"
        >
          {{
            section.to === '/dashboard'
              ? (organization?.name ?? 'Organization overview')
              : section.label
          }}
        </h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-if="data && data.length > 1 && organization"
          :model-value="organization.id"
          :items="data"
          label-key="name"
          value-key="id"
          aria-label="Organization"
          @update:model-value="switchOrganization"
        />
        <template v-if="section.to === '/dashboard' && organization && session">
          <UButton
            :to="{ path: '/members', query: { org: organization.id, action: 'invite' } }"
            color="neutral"
            variant="outline"
            icon="i-lucide-user-plus"
          >
            Invite a member
          </UButton>
          <UButton
            :to="{ path: '/applications', query: { org: organization.id, action: 'register' } }"
            icon="i-lucide-plus"
          >
            Register an app
          </UButton>
        </template>
      </div>
    </header>
    <div
      v-if="error"
      role="alert"
      class="grid justify-items-start gap-2"
    >
      <p>Unable to load your organizations.</p>
      <UButton
        :href="'/api/v1/login?returnTo=' + encodeURIComponent(route.path)"
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
      <OrganizationManagement
        v-if="session"
        :issuer="session.issuer"
        :actor-id="session.user.sub"
        :actor-role="organization.role"
        :key="organization.id + section.to"
        :section="section"
        :organization-id="organization.id"
        @renamed="refresh()"
      />
      <div
        v-else-if="sessionError"
        role="alert"
        class="grid justify-items-start gap-3"
      >
        <p>Unable to load your console session.</p>
        <UButton
          color="neutral"
          variant="outline"
          @click="refreshSession()"
        >
          Retry
        </UButton>
      </div>
      <p
        v-else
        role="status"
      >
        Loading your session…
      </p>
    </template>
    <div
      v-else-if="data?.length && route.query.org"
      class="space-y-3"
    >
      <p>This organization is unavailable.</p>
      <UButton to="/applications">View applications</UButton>
    </div>
    <p v-else-if="data">You have no organizations to manage.</p>
    <p
      v-else
      role="status"
    >
      Loading organizations…
    </p>
  </section>
</template>
