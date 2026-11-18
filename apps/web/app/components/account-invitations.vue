<script setup lang="ts">
  type Item = { id: string; organizationName: string; expiresAt: string };

  const { items, nextCursor, pending, error, load, remove } = useOrganizationInvitations<Item>(
    () => ({ action: 'list-mine' }),
  );

  const accepting = shallowRef<string | null>(null);
  const feedback = shallowRef<string | null>(null);
  const failure = shallowRef<string | null>(null);

  async function accept(invitation: Item): Promise<void> {
    if (accepting.value) {
      return;
    }

    accepting.value = invitation.id;
    feedback.value = null;
    failure.value = null;

    try {
      await $fetch(organizationInvitationsEndpoint, {
        method: 'POST',
        retry: 0,
        body: {
          action: 'accept',
          invitationId: invitation.id,
        },
      });
      remove(invitation.id);
      feedback.value = `You joined ${invitation.organizationName}.`;
    } catch {
      failure.value = 'Could not accept the invitation. It may have expired or been canceled.';
    } finally {
      accepting.value = null;
    }
  }
</script>

<template>
  <section
    class="space-y-3 border border-default p-5"
    aria-labelledby="account-invitations"
  >
    <h2
      id="account-invitations"
      class="font-semibold"
    >
      Organization invitations
    </h2>

    <UAlert
      v-if="feedback"
      :description="feedback"
      color="success"
      role="status"
    />

    <UAlert
      v-if="failure || error"
      :description="failure ?? error ?? ''"
      color="error"
      role="alert"
    />

    <ul
      v-if="items.length"
      class="divide-y divide-default"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="flex items-center justify-between gap-3 py-2"
      >
        <span class="min-w-0 text-sm break-words">{{ item.organizationName }}</span>

        <UButton
          :loading="accepting === item.id"
          :disabled="accepting !== null || pending"
          :aria-label="`Accept invitation to ${item.organizationName}`"
          label="Accept"
          @click="accept(item)"
        />
      </li>
    </ul>

    <p
      v-else-if="!pending && !error"
      class="text-sm text-muted"
    >
      No pending invitations.
    </p>

    <UButton
      v-if="nextCursor || error"
      :disabled="pending || accepting !== null"
      :label="nextCursor ? 'More invitations' : 'Retry invitations'"
      variant="ghost"
      @click="load(nextCursor ? 'next' : 'first')"
    />
  </section>
</template>
