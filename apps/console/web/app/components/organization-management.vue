<script setup lang="ts">
  import type { ManagementActionName } from '~/utils/management';
  import * as valibot from 'valibot';
  import { detailsSchema, managementSections, operations } from '~/utils/management';

  type Props = {
    section: (typeof managementSections)[number];
    issuer: string;
    organizationId: string;
    actorId: string;
    actorRole: string;
  };

  const props = defineProps<Props>();
  const route = useRoute();
  const selectedAction = ref<ManagementActionName>();
  const emit = defineEmits<{ renamed: [] }>();
  const { data, error, refresh } = await useAsyncData(
    `management-details-${props.organizationId}`,
    async () =>
      valibot.parse(
        detailsSchema,
        await $fetch('/api/v1/management', {
          method: 'POST',
          body: {
            action: 'details',
            organizationId: props.organizationId,
          },
        }),
      ),
    { server: false },
  );

  const installation = computed(() =>
    data.value?.installations.find(({ clientId }) => clientId === route.query.client),
  );

  const resources = computed(() => [
    {
      label: 'Members',
      total: data.value?.members.length,
      path: '/members',
    },
    {
      label: 'Invitations',
      total: data.value?.invitations.length,
      path: '/invitations',
    },
    {
      label: 'Applications',
      total: data.value?.installations.length,
      path: '/applications',
    },
    {
      label: 'Role assignments',
      total: data.value?.assignments.length,
      path: '/access',
    },
  ]);

  watch(
    () => route.query.action,
    (requested) => {
      selectedAction.value = props.section.actions.find((action) => action === requested);
    },
    { immediate: true },
  );

  async function update(action: string): Promise<void> {
    if (action === 'rename') {
      emit('renamed');
    }

    await refresh();
  }
</script>

<template>
  <div
    v-if="error"
    role="alert"
  >
    <p>Unable to read organization details.</p>
    <UButton
      variant="link"
      @click="refresh()"
    >
      Retry
    </UButton>
  </div>
  <template v-else-if="data">
    <AccessDashboard
      :organization-id="organizationId"
      v-if="section.to === '/dashboard'"
      :details="data"
    />
    <template v-else-if="section.to === '/applications' && route.query.client">
      <ApplicationWorkspace
        v-if="installation"
        :key="installation.clientId"
        :installation="installation"
        :details="data"
        :issuer="issuer"
        :organization-id="organizationId"
        :actor-id="actorId"
        :actor-role="actorRole"
        @saved="update"
      />
      <div
        v-else
        class="space-y-3"
      >
        <h1 class="text-xl font-semibold">Application unavailable</h1>
        <p>This organization has no matching installation.</p>
        <UButton to="/applications">View applications</UButton>
      </div>
    </template>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="(action, index) in section.actions"
            :key="action"
            :color="index === 0 ? 'primary' : 'neutral'"
            :variant="index === 0 ? 'solid' : 'outline'"
            :aria-expanded="selectedAction === action"
            @click="selectedAction = selectedAction === action ? undefined : action"
          >
            {{ operations[action] }}
          </UButton>
        </div>
      </div>
      <UModal
        :open="Boolean(selectedAction)"
        :title="selectedAction ? operations[selectedAction] : undefined"
        @update:open="
          (open) => {
            if (!open) selectedAction = undefined;
          }
        "
      >
        <template #body>
          <div
            v-if="selectedAction"
            class="grid gap-5"
          >
            <ManagementAction
              :key="selectedAction"
              :action="selectedAction"
              :actor-id="actorId"
              :actor-role="actorRole"
              :organization-id="organizationId"
              :details="data"
              @saved="update"
            />
            <div class="border-t border-muted pt-3">
              <UButton
                :href="issuer + '/passkeys'"
                target="_blank"
                rel="noopener noreferrer"
                color="neutral"
                variant="link"
                trailing-icon="i-lucide-external-link"
              >
                Verify with a passkey
              </UButton>
            </div>
          </div>
        </template>
      </UModal>
      <section
        v-if="section.to === '/management'"
        class="grid gap-5 rounded-lg border border-muted bg-muted p-5 sm:p-6"
      >
        <h2 class="font-semibold">Organization details</h2>
        <nav
          aria-label="Organization resources"
          class="grid grid-cols-2 divide-x divide-muted border-y border-muted sm:grid-cols-4"
        >
          <NuxtLink
            v-for="resource in resources"
            :key="resource.path"
            :to="{ path: resource.path, query: { org: organizationId } }"
            class="grid gap-2 p-4 transition-all hover:bg-muted"
          >
            <span class="font-mono text-2xl tabular-nums">{{ resource.total }}</span>
            <span class="text-sm text-muted">{{ resource.label }}</span>
          </NuxtLink>
        </nav>
        <dl class="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="mb-1 text-muted">Organization ID</dt>
            <dd class="break-all font-mono">{{ organizationId }}</dd>
          </div>
          <div>
            <dt class="mb-1 text-muted">Your organization role</dt>
            <dd>
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ actorRole }}
              </UBadge>
            </dd>
          </div>
        </dl>
      </section>
      <DirectoryTable
        :organization-id="organizationId"
        v-else
        :path="section.to"
        :details="data"
      />
    </template>
  </template>
  <p
    v-else
    role="status"
  >
    Loading organization details…
  </p>
</template>
