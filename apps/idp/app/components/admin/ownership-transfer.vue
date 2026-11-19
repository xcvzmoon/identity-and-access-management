<script setup lang="ts">
  import { safeParse } from 'valibot';

  type Props = { organizationId: string };
  type Candidate = { id: string; name: string; email: string };

  const maxSearchLength = 150;
  const props = defineProps<Props>();
  const emit = defineEmits<{ transferred: []; 'require-verification': [] }>();
  const searchInput = shallowRef<string>('');
  const search = shallowRef<string>('');
  const selectedId = shallowRef<string | null>(null);
  const confirmation = shallowRef<Candidate | null>(null);
  const saving = shallowRef<boolean>(false);
  const failure = shallowRef<string | null>(null);

  const { items, error, pending, load, hasMore } = useAdminCollection<Candidate>(
    () => ({
      collection: 'ownership-candidates',
      organizationId: props.organizationId,
      search: search.value,
    }),
    ({ id }) => id,
    () => emit('require-verification'),
  );

  const busy = computed<boolean>(() => pending.value || saving.value);
  const selected = computed<Candidate | undefined>(() =>
    items.value.find(({ id }) => id === selectedId.value),
  );
  const candidates = computed<{ label: string; value: string }[]>(() =>
    items.value.map(({ id, name, email }) => ({
      label: `${name} (${email})`,
      value: id,
    })),
  );

  async function searchCandidates(): Promise<void> {
    confirmation.value = null;
    selectedId.value = null;
    search.value = searchInput.value.trim();
    await load('first');
  }

  async function transfer(): Promise<void> {
    const candidate = confirmation.value;
    if (!candidate || busy.value) {
      return;
    }

    saving.value = true;
    failure.value = null;

    try {
      await $fetch('/api/auth/admin/transfer-ownership', {
        method: 'POST',
        retry: 0,
        body: {
          organizationId: props.organizationId,
          memberId: candidate.id,
        },
      });
      emit('transferred');
    } catch (error_) {
      const parsed = safeParse(adminErrorSchema, error_);
      const reason = parsed.success ? parsed.output : null;
      if (reason?.data?.code === 'PASSKEY_REQUIRED') {
        emit('require-verification');
      } else {
        confirmation.value = null;
        failure.value = adminRequestMessage(
          reason,
          'Could not transfer ownership. Check your role and the recipient’s membership before retrying.',
        );
      }
    } finally {
      saving.value = false;
    }
  }
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Transfer ownership</h2>
    </template>

    <div class="space-y-4">
      <UAlert
        v-if="failure || error"
        :description="failure ?? error ?? ''"
        color="error"
        role="alert"
      />

      <form
        class="flex items-end gap-2"
        @submit.prevent="searchCandidates"
      >
        <UFormField
          label="Find a new owner"
          class="min-w-0 flex-1"
        >
          <UInput
            v-model="searchInput"
            :maxlength="maxSearchLength"
            :disabled="busy"
            placeholder="Name or email"
            class="w-full"
          />
        </UFormField>

        <UButton
          :disabled="busy"
          label="Search candidates"
          type="submit"
          variant="outline"
        />
      </form>

      <UFormField label="New owner">
        <USelectMenu
          :model-value="selected?.id"
          :disabled="busy || !candidates.length || confirmation !== null"
          :items="candidates"
          value-key="value"
          placeholder="Select a verified member"
          class="w-full"
          @update:model-value="selectedId = $event ?? null"
        />
      </UFormField>

      <p
        v-if="!pending && !error && !candidates.length"
        class="text-sm text-muted"
      >
        No eligible members found.
      </p>

      <UButton
        v-if="hasMore"
        :disabled="busy || confirmation !== null"
        label="More candidates"
        variant="ghost"
        @click="load('next')"
      />

      <div
        v-if="confirmation"
        class="space-y-3 border border-default p-3"
        aria-label="Confirm ownership transfer"
      >
        <p class="text-sm break-words">
          Make
          <strong>{{ confirmation.name }} ({{ confirmation.email }})</strong>
          the owner? You’ll become an administrator.
        </p>

        <div class="flex flex-wrap gap-2">
          <UButton
            :loading="saving"
            label="Confirm transfer"
            color="error"
            @click="transfer"
          />

          <UButton
            :disabled="busy"
            label="Cancel"
            variant="ghost"
            @click="confirmation = null"
          />
        </div>
      </div>

      <UButton
        v-else
        :disabled="busy || !selected"
        label="Transfer ownership"
        color="error"
        variant="outline"
        @click="confirmation = selected ?? null"
      />
    </div>
  </UCard>
</template>
