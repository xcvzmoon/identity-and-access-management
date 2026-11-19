<script setup lang="ts">
  type App = { id: string; name: string };
  type Props = {
    organizationId: string;
    registeredApp: App | null;
    membershipRevision: number;
  };

  const props = defineProps<Props>();
  const emit = defineEmits<{ 'require-verification': []; 'client-changed': [clientId: string] }>();

  const { items, hasMore, pending, error, load } = useAdminCollection<App>(
    () => ({
      collection: 'apps',
      organizationId: props.organizationId,
    }),
    ({ id }) => id,
    () => emit('require-verification'),
  );

  const installationId = shallowRef<string | undefined>();
  const credentialWritePending = shallowRef<boolean>(false);

  const apps = computed<App[]>(() => {
    const registered = props.registeredApp;
    if (registered && !items.value.some(({ id }) => id === registered.id)) {
      return [...items.value, registered];
    }

    return [...items.value];
  });

  const appItems = computed<{ label: string; value: string }[]>(() =>
    apps.value.map(({ id, name }) => ({
      label: name,
      value: id,
    })),
  );

  async function reload(): Promise<void> {
    installationId.value = props.registeredApp?.id;
    await load('first');
  }

  watch(
    () => props.registeredApp,
    (app) => {
      if (app) {
        installationId.value = app.id;
      }
    },
    { immediate: true },
  );
</script>

<template>
  <section
    class="min-w-0 space-y-4"
    aria-labelledby="app-access"
  >
    <div class="space-y-4 border border-default bg-elevated/40 p-5">
      <h2
        id="app-access"
        class="font-semibold"
      >
        App access
      </h2>

      <UAlert
        v-if="error"
        :description="error"
        color="error"
        role="alert"
      />

      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          label="Registered app"
          class="min-w-40 flex-1"
        >
          <USelect
            v-model="installationId"
            :items="appItems"
            :disabled="pending || credentialWritePending || !apps.length"
            placeholder="Choose an app"
            class="w-full"
          />
        </UFormField>

        <UButton
          v-if="hasMore"
          :loading="pending"
          :disabled="credentialWritePending"
          label="More apps"
          variant="outline"
          @click="load('next')"
        />

        <UButton
          :loading="pending"
          :disabled="credentialWritePending"
          label="Reload apps"
          variant="ghost"
          @click="reload"
        />
      </div>

      <p
        v-if="!pending && !error && !apps.length"
        class="text-sm text-muted"
      >
        No apps registered in this organization.
      </p>
    </div>

    <AdminApplicationCredentials
      v-if="installationId"
      :key="installationId"
      :installation-id="installationId"
      @client-changed="emit('client-changed', $event)"
      @require-verification="emit('require-verification')"
      @write-pending="credentialWritePending = $event"
    />

    <AdminAppAccessEditor
      v-if="installationId"
      :key="`${installationId}:${membershipRevision}`"
      :installation-id="installationId"
      @require-verification="emit('require-verification')"
    />
  </section>
</template>
