<script setup lang="ts">
  import { safeParse } from 'valibot';

  type Item = { id: string; email: string; expiresAt: string };
  type Props = { organizationId: string };
  type Change = { action: 'invite'; email: string } | { action: 'cancel'; invitationId: string };
  type InviteResult = { invitationId: string; notified: boolean };
  type CancelResult = { canceled: true };
  type Feedback = { color: 'success' | 'error'; message: string };

  const maxEmailLength = 254;
  const props = defineProps<Props>();
  const emit = defineEmits<{ 'require-verification': [] }>();

  const { items, nextCursor, pending, error, load, remove } = useOrganizationInvitations<Item>(
    () => ({
      action: 'list-pending',
      organizationId: props.organizationId,
    }),
    () => emit('require-verification'),
  );

  const email = shallowRef<string>('');
  const saving = shallowRef<boolean>(false);
  const feedback = shallowRef<Feedback | null>(null);

  const busy = computed<boolean>(() => saving.value || pending.value);

  async function changeInvitation(change: Change): Promise<void> {
    if (busy.value) {
      return;
    }

    saving.value = true;
    feedback.value = null;

    try {
      const result = await $fetch<InviteResult | CancelResult>(organizationInvitationsEndpoint, {
        method: 'POST',
        retry: 0,
        body: {
          organizationId: props.organizationId,
          ...change,
        },
      });

      if ('notified' in result) {
        email.value = '';
        feedback.value = {
          color: 'success',
          message: result.notified
            ? 'Invitation sent.'
            : 'Invitation saved. Ask the recipient to open their IAM account.',
        };
        await load('first');
      } else if (change.action === 'cancel') {
        remove(change.invitationId);
        feedback.value = {
          color: 'success',
          message: 'Invitation canceled.',
        };
      }
    } catch (error_) {
      const result = safeParse(adminErrorSchema, error_);
      const failure = result.success ? result.output : null;
      if (failure?.data?.code === 'PASSKEY_REQUIRED') {
        emit('require-verification');
      } else {
        feedback.value = {
          color: 'error',
          message: adminRequestMessage(
            failure,
            'Could not update the invitation. Check whether the recipient is already a member or has an invitation.',
          ),
        };
      }
    } finally {
      saving.value = false;
    }
  }
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Organization invitations</h2>
    </template>

    <div class="space-y-4">
      <form
        class="space-y-3"
        @submit.prevent="changeInvitation({ action: 'invite', email })"
      >
        <UFormField
          label="Invitee email"
          description="Invitations grant organization membership."
        >
          <UInput
            v-model="email"
            :disabled="busy"
            :maxlength="maxEmailLength"
            type="email"
            autocomplete="off"
            class="w-full"
            required
          />
        </UFormField>

        <UButton
          :disabled="busy"
          label="Invite member"
          type="submit"
        />
      </form>

      <UAlert
        v-if="feedback"
        :description="feedback.message"
        :color="feedback.color"
        :role="feedback.color === 'error' ? 'alert' : 'status'"
      />

      <UAlert
        v-if="error"
        :description="error"
        color="error"
        role="alert"
      />

      <ul
        v-if="items.length"
        class="divide-y divide-default border-y border-default"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="flex flex-wrap items-center justify-between gap-2 py-2"
        >
          <span class="text-sm break-all">{{ item.email }}</span>

          <UButton
            :disabled="busy"
            :aria-label="`Cancel invitation for ${item.email}`"
            label="Cancel"
            variant="ghost"
            @click="changeInvitation({ action: 'cancel', invitationId: item.id })"
          />
        </li>
      </ul>

      <p
        v-else-if="!busy && !error"
        class="text-sm text-muted"
      >
        No pending invitations.
      </p>

      <UButton
        v-if="nextCursor || error"
        :disabled="busy"
        :label="nextCursor ? 'More invitations' : 'Retry invitations'"
        variant="ghost"
        @click="load(nextCursor ? 'next' : 'first')"
      />
    </div>
  </UCard>
</template>
