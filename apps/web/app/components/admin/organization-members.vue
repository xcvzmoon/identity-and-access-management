<script setup lang="ts">
  import { safeParse } from 'valibot';

  type Props = { organizationId: string; owner: boolean };
  type MemberRole = 'member' | 'admin';
  type Member = {
    id: string;
    name: string;
    email: string;
    suspended: boolean;
    role: MemberRole;
    promotionEligible: boolean;
  };
  type Selection = { member: Member; kind: 'role' | 'status' };
  type Status = 'active' | 'suspended';
  type Change = { role: MemberRole } | { status: Status };

  const maxSearchLength = 150;
  const props = defineProps<Props>();
  const emit = defineEmits<{ 'require-verification': []; 'status-changed': [] }>();
  const searchInput = shallowRef<string>('');
  const search = shallowRef<string>('');
  const selected = shallowRef<Selection | null>(null);
  const saving = shallowRef<boolean>(false);
  const notice = shallowRef<string | null>(null);
  const failure = shallowRef<string | null>(null);

  const { items, error, pending, load, upsert, hasMore } = useAdminCollection<Member>(
    () => ({
      collection: 'organization-members',
      organizationId: props.organizationId,
      search: search.value,
    }),
    ({ id }) => id,
    () => emit('require-verification'),
  );

  const busy = computed<boolean>(() => saving.value || pending.value);

  async function searchMembers(): Promise<void> {
    selected.value = null;
    search.value = searchInput.value.trim();
    await load('first');
  }

  function canChangeRole(member: Member): boolean {
    return props.owner && (member.role === 'admin' || member.promotionEligible);
  }

  function confirmationLabel(selection: Selection): string {
    if (selection.kind === 'role') {
      return selection.member.role === 'admin' ? 'Confirm demotion' : 'Confirm promotion';
    }

    return selection.member.suspended ? 'Confirm reinstatement' : 'Confirm suspension';
  }

  function confirmationText(selection: Selection): string {
    const { member, kind } = selection;

    if (kind === 'role') {
      return member.role === 'admin'
        ? 'Remove this member’s administrator permissions? Their app assignments will stay in place.'
        : 'Give this member administrator permissions for this organization? They’ll need to verify a passkey to use them.';
    }

    return member.suspended
      ? 'Reinstate this member and restore their existing assignments for new sign-ins?'
      : 'Suspend this member and invalidate their access to apps in this organization?';
  }

  function desiredChange(selection: Selection): Change {
    const { member, kind } = selection;

    if (kind === 'role') {
      return { role: member.role === 'member' ? 'admin' : 'member' };
    }

    return { status: member.suspended ? 'active' : 'suspended' };
  }

  async function changeMember(): Promise<void> {
    const selection = selected.value;
    if (!selection || busy.value) {
      return;
    }

    saving.value = true;
    failure.value = null;
    notice.value = null;
    const { member } = selection;
    const change = desiredChange(selection);
    const endpoint =
      'role' in change ? '/api/auth/admin/member-role' : '/api/auth/admin/member-status';

    try {
      await $fetch(endpoint, {
        method: 'POST',
        retry: 0,
        body: {
          organizationId: props.organizationId,
          memberId: member.id,
          ...change,
        },
      });
      selected.value = null;

      if ('role' in change) {
        upsert({
          ...member,
          role: change.role,
        });
        notice.value =
          change.role === 'admin'
            ? 'Member is now an administrator.'
            : 'Administrator permissions removed.';
      } else {
        upsert({
          ...member,
          suspended: change.status === 'suspended',
        });
        emit('status-changed');
        notice.value = change.status === 'suspended' ? 'Member suspended.' : 'Member reinstated.';
      }
    } catch (error_) {
      const parsed = safeParse(adminErrorSchema, error_);
      const reason = parsed.success ? parsed.output : null;
      if (reason?.data?.code === 'PASSKEY_REQUIRED') {
        emit('require-verification');
      } else {
        failure.value = adminRequestMessage(reason, 'Could not update this member.');
      }
    } finally {
      saving.value = false;
    }
  }
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Organization members</h2>
    </template>

    <div class="space-y-3">
      <form
        class="flex items-end gap-2"
        @submit.prevent="searchMembers"
      >
        <UFormField
          label="Find an organization member"
          class="min-w-0 flex-1"
        >
          <UInput
            v-model="searchInput"
            :disabled="busy"
            :maxlength="maxSearchLength"
            class="w-full"
            placeholder="Name or email"
          />
        </UFormField>

        <UButton
          :disabled="busy"
          label="Search members"
          type="submit"
          variant="outline"
        />
      </form>

      <UAlert
        v-if="failure || error"
        :description="failure ?? error ?? ''"
        color="error"
        role="alert"
      />

      <UAlert
        v-if="notice"
        :description="notice"
        color="success"
        role="status"
      />

      <ul
        v-if="items.length"
        class="divide-y divide-default"
      >
        <li
          v-for="member in items"
          :key="member.id"
          class="space-y-2 py-2"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium break-words">{{ member.name }}</p>
              <p class="text-xs break-all text-muted">{{ member.email }}</p>

              <p class="text-xs text-muted">
                {{ member.role === 'admin' ? 'Administrator' : 'Member' }} ·
                {{ member.suspended ? 'Suspended' : 'Active' }}
              </p>
            </div>

            <div
              v-if="selected?.member.id !== member.id"
              class="flex flex-wrap gap-2"
            >
              <UButton
                v-if="member.role === 'member'"
                :disabled="busy"
                :label="member.suspended ? 'Reinstate' : 'Suspend'"
                :aria-label="`${member.suspended ? 'Reinstate' : 'Suspend'} ${member.email}`"
                variant="outline"
                @click="selected = { member, kind: 'status' }"
              />

              <UButton
                v-if="canChangeRole(member)"
                :disabled="busy"
                :label="member.role === 'admin' ? 'Remove admin role' : 'Make admin'"
                :aria-label="`${member.role === 'admin' ? 'Remove admin role from' : 'Make admin:'} ${member.email}`"
                variant="outline"
                @click="selected = { member, kind: 'role' }"
              />
            </div>
          </div>

          <div
            v-if="selected?.member.id === member.id"
            class="space-y-2"
          >
            <p class="text-sm text-muted">{{ confirmationText(selected) }}</p>

            <div class="flex flex-wrap gap-2">
              <UButton
                :disabled="busy"
                :label="confirmationLabel(selected)"
                :color="selected.kind === 'role' || !member.suspended ? 'error' : 'primary'"
                @click="changeMember"
              />

              <UButton
                :disabled="busy"
                label="Cancel"
                variant="ghost"
                @click="selected = null"
              />
            </div>
          </div>
        </li>
      </ul>

      <p
        v-else-if="!pending && !error"
        class="text-sm text-muted"
      >
        No members found.
      </p>

      <UButton
        v-if="hasMore"
        :disabled="busy"
        label="More members"
        variant="ghost"
        @click="load('next')"
      />
    </div>
  </UCard>
</template>
