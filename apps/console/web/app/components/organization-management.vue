<script setup lang="ts">
  import type { ManagementActionName } from '~/utils/management';
  import * as valibot from 'valibot';
  import { detailsSchema, operations } from '~/utils/management';

  type Props = { organizationId: string; actorId: string; actorRole: string };

  const props = defineProps<Props>();
  const selectedAction = ref<ManagementActionName>('invite');
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
    <section class="grid gap-3">
      <h3 class="text-lg font-semibold">Members</h3>
      <ul>
        <li
          v-for="member in data.members"
          :key="member.userId"
        >
          {{ member.email }} · {{ member.role }}
        </li>
      </ul>
      <h3 class="text-lg font-semibold">Invitations</h3>
      <p v-if="!data.invitations.length">No invitations.</p>
      <ul v-else>
        <li
          v-for="(invitation, index) in data.invitations"
          :key="index"
        >
          {{ invitation.email }} · {{ invitation.role }} · {{ invitation.status }}
        </li>
      </ul>
      <h3 class="text-lg font-semibold">App installations</h3>
      <p v-if="!data.installations.length">No installations.</p>
      <ul
        v-else
        class="grid gap-3"
      >
        <li
          v-for="installation in data.installations"
          :key="installation.clientId"
        >
          <strong>{{ installation.name }}</strong>
          ·
          <code>{{ installation.clientId }}</code>
          <ul>
            <li
              v-for="(permissions, role) in installation.rolePermissions"
              :key="role"
            >
              {{ role }} · {{ permissions.join(', ') }}
            </li>
          </ul>
        </li>
      </ul>
      <h3 class="text-lg font-semibold">Role assignments</h3>
      <p v-if="!data.assignments.length">No assignments.</p>
      <ul v-else>
        <li
          v-for="assignment in data.assignments"
          :key="JSON.stringify(assignment)"
        >
          {{ data.members.find(({ userId }) => userId === assignment.userId)?.email }} ·
          {{ data.installations.find(({ clientId }) => clientId === assignment.clientId)?.name }} ·
          {{ assignment.role }}
        </li>
      </ul>
    </section>
    <label class="grid gap-1">
      Management action
      <select
        v-model="selectedAction"
        class="rounded border border-default bg-default p-2"
      >
        <option
          v-for="(label, action) in operations"
          :key="action"
          :value="action"
        >
          {{ label }}
        </option>
      </select>
    </label>
    <ManagementAction
      :key="selectedAction"
      :action="selectedAction"
      :actor-id="actorId"
      :actor-role="actorRole"
      :organization-id="organizationId"
      :details="data"
      @saved="update"
    />
  </template>
  <p
    v-else
    role="status"
  >
    Loading organization details…
  </p>
</template>
