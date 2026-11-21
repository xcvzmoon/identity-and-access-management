<script setup lang="ts">
  import type { ManagementActionName, OrganizationDetails } from '~/utils/management';
  import { operations } from '~/utils/management';

  type Props = {
    details: OrganizationDetails;
    installation: OrganizationDetails['installations'][number];
    organizationId: string;
    actorId: string;
    actorRole: string;
    issuer: string;
  };

  const props = defineProps<Props>();
  const toast = useToast();
  const emit = defineEmits<{ saved: [action: string] }>();
  const tabs = [
    {
      label: 'Overview',
      slot: 'overview',
      value: 'overview',
    },
    {
      label: 'Access',
      slot: 'access',
      value: 'access',
    },
    {
      label: 'Permissions',
      slot: 'permissions',
      value: 'permissions',
    },
  ];
  const PREVIEW_LIMIT = 5;
  const tab = ref('overview');
  const action = ref<ManagementActionName | null>(null);
  const access = computed(() => {
    const members = new Map(props.details.members.map((member) => [member.userId, member]));
    return props.details.assignments
      .filter(({ clientId }) => clientId === props.installation.clientId)
      .map(({ userId, role }) => {
        const member = members.get(userId);
        return {
          userId,
          member: member?.name || member?.email || userId,
          email: member?.email ?? '—',
          role,
        };
      });
  });
  const permissions = computed(() =>
    Object.entries(props.installation.rolePermissions).map(([role, items]) => ({
      role,
      permissions: items.join(', ') || 'No permissions',
    })),
  );

  function finishAction(saved: ManagementActionName): void {
    action.value = null;
    emit('saved', saved);
    toast.add({ title: 'Changes saved.' });
  }

  watch(tab, () => {
    action.value = null;
  });
</script>

<template>
  <section class="min-w-0 space-y-6">
    <div>
      <ULink :to="{ path: '/applications', query: { org: organizationId } }">Applications</ULink>
      <h1 class="mt-4 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
        {{ installation.name }}
      </h1>
      <p class="mt-2 break-all font-mono text-sm text-muted">{{ installation.clientId }}</p>
    </div>
    <UModal
      :open="Boolean(action)"
      :title="action ? operations[action] : undefined"
      @update:open="
        (open) => {
          if (!open) {
            action = null;
          }
        }
      "
    >
      <template #body>
        <div
          v-if="action"
          class="grid gap-5"
        >
          <ManagementAction
            :key="action"
            :action="action"
            :client-id="installation.clientId"
            :organization-id="organizationId"
            :actor-id="actorId"
            :actor-role="actorRole"
            :details="details"
            @saved="finishAction"
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
    <UTabs
      v-model="tab"
      :items="tabs"
      variant="link"
      color="neutral"
    >
      <template #overview>
        <div class="grid items-start gap-6 py-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(15rem,1fr)]">
          <section
            class="min-w-0 overflow-hidden rounded-lg border border-muted bg-(--iam-surface)"
          >
            <header
              class="flex flex-wrap items-center justify-between gap-3 border-b border-muted p-4"
            >
              <h2 class="text-lg font-semibold">Assigned members</h2>
              <UButton @click="action = 'assign'">Assign role</UButton>
            </header>
            <ul class="divide-y divide-muted px-4">
              <li
                v-for="member in access.slice(0, PREVIEW_LIMIT)"
                :key="member.userId + member.role"
                class="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <UAvatar
                  :alt="member.member"
                  size="sm"
                />
                <div class="min-w-0 flex-1 break-all">
                  <strong class="block font-medium">{{ member.member }}</strong>
                  <span
                    v-if="member.email !== member.member"
                    class="text-muted"
                  >
                    {{ member.email }}
                  </span>
                </div>
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ member.role }}
                </UBadge>
              </li>
            </ul>
            <p
              v-if="!access.length"
              class="p-4 text-sm text-muted"
            >
              No members have been assigned access.
            </p>
            <div class="border-t border-muted px-4 py-2">
              <UButton
                color="neutral"
                variant="link"
                trailing-icon="i-lucide-arrow-right"
                @click="tab = 'access'"
              >
                View all assignments ({{ access.length }})
              </UButton>
            </div>
          </section>
          <section class="grid gap-4 rounded-lg border border-muted bg-(--iam-surface) p-5">
            <h2 class="text-lg font-semibold">Installation roles</h2>
            <dl class="grid gap-4 text-sm">
              <div
                v-for="entry in permissions.slice(0, PREVIEW_LIMIT)"
                :key="entry.role"
              >
                <dt class="font-medium">{{ entry.role }}</dt>
                <dd class="mt-1 break-words text-muted">{{ entry.permissions }}</dd>
              </div>
            </dl>
            <p
              v-if="!permissions.length"
              class="text-sm text-muted"
            >
              No installation roles defined.
            </p>
            <div>
              <UButton
                color="neutral"
                variant="outline"
                @click="tab = 'permissions'"
              >
                Manage permissions
              </UButton>
            </div>
          </section>
          <div>
            <UButton
              color="error"
              variant="ghost"
              @click="action = 'disableInstallation'"
            >
              Disable installation
            </UButton>
          </div>
        </div>
      </template>
      <template #access>
        <div class="space-y-4 py-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold">Assigned members</h2>
            <div class="flex gap-2">
              <UButton @click="action = 'assign'">Assign role</UButton>
              <UButton
                color="neutral"
                variant="outline"
                @click="action = 'revoke'"
              >
                Revoke access
              </UButton>
            </div>
          </div>
          <div class="overflow-hidden rounded-lg border border-muted bg-(--iam-surface)">
            <UTable
              :columns="[
                { accessorKey: 'member', header: 'Member' },
                { accessorKey: 'email', header: 'Email' },
                { accessorKey: 'role', header: 'Role' },
              ]"
              :data="access"
              empty="No members have been assigned access."
            />
          </div>
        </div>
      </template>
      <template #permissions>
        <div class="space-y-4 py-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold">Role permissions</h2>
            <UButton @click="action = 'defineRole'">Define role</UButton>
          </div>
          <div class="overflow-hidden rounded-lg border border-muted bg-(--iam-surface)">
            <UTable
              :data="permissions"
              empty="No roles defined for this application."
            />
          </div>
        </div>
      </template>
    </UTabs>
  </section>
</template>
