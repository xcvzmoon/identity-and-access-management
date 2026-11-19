<script setup lang="ts">
  import { safeParse } from 'valibot';

  type Props = { installationId: string };
  type Permission = { key: string };
  type Role = { key: string; permissionKeys: readonly string[] };
  type Member = {
    id: string;
    name: string;
    email: string;
    assigned: boolean;
    roleKeys: readonly string[];
  };
  type AssignmentChange =
    | { action: 'grant'; memberId: string; roleKeys: string[] }
    | { action: 'revoke'; memberId: string };
  type AccessChange =
    | { action: 'register-permissions'; permissionKeys: string[] }
    | { action: 'save-role'; role: Role }
    | { action: 'change-assignment'; change: AssignmentChange };
  type Feedback = { color: 'success' | 'error'; message: string };

  const maxKeyLength = 100;
  const maxSearchLength = 150;

  const props = defineProps<Props>();
  const emit = defineEmits<{ 'require-verification': [] }>();

  const permissionKey = shallowRef<string>('');
  const roleKey = shallowRef<string>('');
  const rolePermissions = shallowRef<string[]>([]);
  const selectedRoleKey = shallowRef<string | undefined>();
  const selectedMemberId = shallowRef<string | undefined>();
  const memberRoles = shallowRef<string[]>([]);
  const pendingSearch = shallowRef<string>('');
  const search = shallowRef<string>('');
  const confirmingRevocation = shallowRef<boolean>(false);
  const feedback = shallowRef<Feedback | null>(null);
  const saving = shallowRef<boolean>(false);

  function requireVerification(): void {
    emit('require-verification');
  }

  const permissions = useAdminCollection<Permission>(
    () => ({
      collection: 'permissions',
      installationId: props.installationId,
    }),
    ({ key }) => key,
    requireVerification,
  );
  const roles = useAdminCollection<Role>(
    () => ({
      collection: 'roles',
      installationId: props.installationId,
    }),
    ({ key }) => key,
    requireVerification,
  );
  const members = useAdminCollection<Member>(
    () => ({
      collection: 'members',
      installationId: props.installationId,
      search: search.value,
    }),
    ({ id }) => id,
    requireVerification,
  );

  const permissionChoices = computed<string[]>(() => [
    ...new Set([...permissions.items.value.map(({ key }) => key), ...rolePermissions.value]),
  ]);
  const roleKeys = computed<string[]>(() => roles.items.value.map(({ key }) => key));
  const roleChoices = computed<string[]>(() => [
    ...new Set([...roleKeys.value, ...memberRoles.value]),
  ]);
  const memberItems = computed<{ label: string; value: string }[]>(() =>
    members.items.value.map(({ id, name, email }) => ({
      label: `${name} (${email})`,
      value: id,
    })),
  );
  const selectedMember = computed<Member | undefined>(() =>
    members.items.value.find(({ id }) => id === selectedMemberId.value),
  );

  function selectRole(key?: string): void {
    const role = roles.items.value.find((item) => item.key === key);
    selectedRoleKey.value = role?.key;
    roleKey.value = role?.key ?? '';
    rolePermissions.value = [...(role?.permissionKeys ?? [])];
  }

  function selectMember(id?: string): void {
    selectedMemberId.value = id;
    memberRoles.value = [...(selectedMember.value?.roleKeys ?? [])];
    confirmingRevocation.value = false;
  }

  async function searchMembers(): Promise<void> {
    selectMember();
    search.value = pendingSearch.value.trim();
    await members.load('first');
  }

  async function write(change: AccessChange, success: string): Promise<boolean> {
    if (saving.value) {
      return false;
    }

    saving.value = true;
    feedback.value = null;

    try {
      await $fetch(adminInteractionEndpoint, {
        method: 'POST',
        retry: 0,
        body: {
          ...change,
          installationId: props.installationId,
        },
      });
      feedback.value = {
        color: 'success',
        message: success,
      };
      return true;
    } catch (error) {
      const parsed = safeParse(adminErrorSchema, error);
      const failure = parsed.success ? parsed.output : null;
      if (failure?.data?.code === 'PASSKEY_REQUIRED') {
        requireVerification();
      } else {
        feedback.value = {
          color: 'error',
          message: adminRequestMessage(
            failure,
            'The change could not be saved. Check the values and try again.',
          ),
        };
      }

      return false;
    } finally {
      saving.value = false;
    }
  }

  async function addPermission(): Promise<void> {
    const key = permissionKey.value.trim();
    if (
      key &&
      (await write(
        {
          action: 'register-permissions',
          permissionKeys: [key],
        },
        'Permission saved.',
      ))
    ) {
      permissions.upsert({ key });
      permissionKey.value = '';
    }
  }

  async function saveRole(): Promise<void> {
    const role = {
      key: roleKey.value.trim(),
      permissionKeys: rolePermissions.value,
    };

    if (
      role.key &&
      (await write(
        {
          action: 'save-role',
          role,
        },
        'Role saved.',
      ))
    ) {
      roles.upsert(role);
      selectRole(role.key);
    }
  }

  async function saveAssignment(action: AssignmentChange['action']): Promise<void> {
    const member = selectedMember.value;
    if (!member) {
      return;
    }

    const change: AssignmentChange =
      action === 'grant'
        ? {
            action,
            memberId: member.id,
            roleKeys: memberRoles.value,
          }
        : {
            action,
            memberId: member.id,
          };

    if (
      await write(
        {
          action: 'change-assignment',
          change,
        },
        action === 'grant' ? 'Member access saved.' : 'Member access revoked.',
      )
    ) {
      members.upsert({
        ...member,
        assigned: change.action === 'grant',
        roleKeys: change.action === 'grant' ? change.roleKeys : [],
      });
      selectMember(member.id);
    }
  }
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="feedback"
      :color="feedback.color"
      :description="feedback.message"
      :role="feedback.color === 'error' ? 'alert' : 'status'"
    />

    <section
      class="divide-y divide-default border border-default"
      aria-label="Permission catalog and roles"
    >
      <div class="space-y-4 p-5">
        <h3 class="text-sm font-semibold">Permission catalog</h3>

        <UAlert
          v-if="permissions.error.value"
          :description="permissions.error.value"
          color="error"
          role="alert"
        />

        <ul
          v-if="permissions.items.value.length"
          class="flex flex-wrap gap-2"
        >
          <li
            v-for="permission in permissions.items.value"
            :key="permission.key"
            class="max-w-full"
          >
            <code class="block border border-default px-2 py-1 text-xs break-all">
              {{ permission.key }}
            </code>
          </li>
        </ul>

        <p
          v-else-if="!permissions.pending.value && !permissions.error.value"
          class="text-sm text-muted"
        >
          This app has no permissions yet.
        </p>

        <UButton
          v-if="permissions.hasMore.value || permissions.error.value"
          :loading="permissions.pending.value"
          :disabled="saving"
          :label="permissions.error.value ? 'Retry permissions' : 'More permissions'"
          size="sm"
          variant="ghost"
          @click="permissions.load(permissions.hasMore.value ? 'next' : 'first')"
        />

        <form
          class="flex flex-wrap items-end gap-2"
          @submit.prevent="addPermission"
        >
          <UFormField
            label="New permission key"
            class="min-w-44 flex-1"
          >
            <UInput
              v-model="permissionKey"
              :maxlength="maxKeyLength"
              :disabled="saving || permissions.pending.value"
              placeholder="reports.read"
              class="w-full"
              required
            />
          </UFormField>

          <UButton
            :disabled="saving || permissions.pending.value"
            label="Add permission"
            type="submit"
          />
        </form>
      </div>

      <div class="space-y-4 p-5">
        <h3 class="text-sm font-semibold">Roles</h3>

        <UAlert
          v-if="roles.error.value"
          :description="roles.error.value"
          color="error"
          role="alert"
        />

        <div class="flex flex-wrap items-end gap-2">
          <UFormField
            label="Existing role"
            class="min-w-44 flex-1"
          >
            <USelect
              :model-value="selectedRoleKey"
              :items="roleKeys"
              :disabled="saving || roles.pending.value || !roleKeys.length"
              placeholder="Select a role to edit"
              class="w-full"
              @update:model-value="selectRole"
            />
          </UFormField>

          <UButton
            v-if="selectedRoleKey"
            :disabled="saving"
            label="Clear role selection"
            variant="ghost"
            @click="selectRole()"
          />

          <UButton
            v-if="roles.hasMore.value || roles.error.value"
            :loading="roles.pending.value"
            :disabled="saving"
            :label="roles.error.value ? 'Retry roles' : 'More roles'"
            variant="ghost"
            @click="roles.load(roles.hasMore.value ? 'next' : 'first')"
          />
        </div>

        <form
          class="space-y-4"
          @submit.prevent="saveRole"
        >
          <UFormField label="Role key">
            <UInput
              v-model="roleKey"
              :maxlength="maxKeyLength"
              :disabled="saving || Boolean(selectedRoleKey)"
              placeholder="reviewer"
              class="w-full"
              required
            />
          </UFormField>

          <UFormField
            label="Role permissions"
            description="Saving a role replaces its permissions for all members assigned to it."
          >
            <USelectMenu
              v-model="rolePermissions"
              :items="permissionChoices"
              :disabled="saving || !permissionChoices.length"
              placeholder="Choose permissions"
              class="w-full"
              multiple
            />
          </UFormField>

          <UButton
            :disabled="saving || roles.pending.value"
            label="Save role"
            type="submit"
          />
        </form>
      </div>
    </section>

    <section
      class="space-y-4 border border-default p-5"
      aria-labelledby="member-access"
    >
      <h3
        id="member-access"
        class="text-sm font-semibold"
      >
        Member access
      </h3>

      <UAlert
        v-if="members.error.value"
        :description="members.error.value"
        color="error"
        role="alert"
      />

      <form
        class="flex flex-wrap items-end gap-2"
        @submit.prevent="searchMembers"
      >
        <UFormField
          label="Find a member"
          class="min-w-44 flex-1"
        >
          <UInput
            v-model="pendingSearch"
            :maxlength="maxSearchLength"
            :disabled="saving || members.pending.value"
            placeholder="Name or email"
            class="w-full"
          />
        </UFormField>

        <UButton
          :loading="members.pending.value"
          :disabled="saving"
          label="Search"
          type="submit"
          variant="outline"
        />
      </form>

      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          label="Organization member"
          class="min-w-44 flex-1"
        >
          <USelectMenu
            :model-value="selectedMemberId"
            :items="memberItems"
            :disabled="saving || members.pending.value || !memberItems.length"
            placeholder="Select a member"
            value-key="value"
            class="w-full"
            @update:model-value="selectMember"
          />
        </UFormField>

        <UButton
          v-if="members.hasMore.value"
          :loading="members.pending.value"
          :disabled="saving"
          label="More members"
          variant="ghost"
          @click="members.load('next')"
        />
      </div>

      <p
        v-if="!memberItems.length && !members.pending.value && !members.error.value"
        class="text-sm text-muted"
      >
        No eligible members found.
      </p>

      <form
        v-if="selectedMember"
        class="space-y-4 border-t border-default pt-4"
        @submit.prevent="saveAssignment('grant')"
      >
        <p class="text-sm">
          {{
            selectedMember.assigned
              ? 'This member can sign in to the app.'
              : 'This member has no app access.'
          }}
        </p>

        <UFormField
          label="Assigned roles"
          description="An assignment with no roles allows sign-in without product permissions."
        >
          <USelectMenu
            v-model="memberRoles"
            :items="roleChoices"
            :disabled="saving || !roleChoices.length"
            placeholder="Choose roles"
            class="w-full"
            multiple
          />
        </UFormField>

        <div
          v-if="confirmingRevocation"
          class="space-y-2"
        >
          <p class="text-sm text-muted">Revoke app access for {{ selectedMember.name }}?</p>

          <div class="flex flex-wrap gap-2">
            <UButton
              :disabled="saving"
              label="Confirm revocation"
              color="error"
              @click="saveAssignment('revoke')"
            />

            <UButton
              :disabled="saving"
              label="Cancel"
              variant="ghost"
              @click="confirmingRevocation = false"
            />
          </div>
        </div>

        <div
          v-else
          class="flex flex-wrap gap-2"
        >
          <UButton
            :disabled="saving"
            :label="selectedMember.assigned ? 'Save roles' : 'Grant app access'"
            type="submit"
          />

          <UButton
            v-if="selectedMember.assigned"
            :disabled="saving"
            label="Revoke access"
            color="error"
            variant="outline"
            @click="confirmingRevocation = true"
          />
        </div>
      </form>
    </section>
  </div>
</template>
