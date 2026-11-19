<script setup lang="ts">
  import { safeParse } from 'valibot';

  type Props = { installationId: string };
  type Client = {
    clientId: string;
    disabled: boolean;
    credentialVersion: string;
    redirectUris: string[];
  };
  type Key = { keyId: string; expiresAt: string };
  type Overview = { clients: Client[]; machine: { activeKey: Key | null } | null };
  type ClientOperation =
    | { kind: 'client'; operation: 'rotate-secret' | 'disable'; client: Client }
    | { kind: 'client'; operation: 'replace-callback'; client: Client; redirectUri: string };
  type MachineChange = { action: 'issue' } | { action: 'rotate' | 'revoke'; keyId: string };
  type Operation = ClientOperation | { kind: 'machine'; change: MachineChange };
  type ClientResult =
    | { action: 'disable' }
    | { action: 'rotate-secret'; clientSecret: string; credentialVersion: string }
    | { action: 'replace-callback'; redirectUri: string; credentialVersion: string };
  type MachineResult =
    | { action: 'revoke' }
    | { action: 'issue' | 'rotate'; keyId: string; key: string; expiresAt: string };
  type RevealedCredential = { label: string; secret: string };

  const firstCallback = 0;
  const maximumCallbackLength = 2048;
  const badRequest = 400;

  const props = defineProps<Props>();
  const emit = defineEmits<{
    'require-verification': [];
    'write-pending': [pending: boolean];
    'client-changed': [clientId: string];
  }>();
  const overview = shallowRef<Overview | null>(null);
  const loading = shallowRef<boolean>(false);
  const saving = shallowRef<boolean>(false);
  const failure = shallowRef<string | null>(null);
  const notice = shallowRef<string | null>(null);
  const confirmation = shallowRef<Operation | null>(null);
  const revealed = shallowRef<RevealedCredential | null>(null);
  const callbackClient = shallowRef<Client | null>(null);
  const callbackUrl = shallowRef<string>('');

  const blocked = computed<boolean>(() => loading.value || saving.value || revealed.value !== null);
  const confirmationLabel = computed<string>(() => {
    const operation = confirmation.value;
    if (operation?.kind === 'client') {
      if (operation.operation === 'replace-callback') {
        return 'Replace callback';
      }

      return operation.operation === 'disable' ? 'Disable client' : 'Rotate secret';
    }

    return operation?.change.action === 'revoke' ? 'Revoke machine key' : 'Rotate machine key';
  });
  const confirmationText = computed<string>(() => {
    const operation = confirmation.value;
    if (operation?.kind === 'client') {
      if (operation.operation === 'replace-callback') {
        return 'The previous callback, existing app tokens, and outstanding authorization codes will stop working. The current client secret stays valid.';
      }

      return operation.operation === 'disable'
        ? 'Disabling this client stops new sign-ins and invalidates its app tokens.'
        : 'Rotation immediately invalidates the previous secret and app tokens.';
    }

    return 'The existing machine key will stop working immediately.';
  });

  function reportFailure(
    error: ReturnType<typeof safeParse<typeof adminErrorSchema>>,
    fallback: string,
  ): void {
    const reason = error.success ? error.output : null;
    if (reason?.data?.code === 'PASSKEY_REQUIRED') {
      emit('require-verification');
    } else if (reason?.data?.code === 'CLIENT_CREDENTIAL_CHANGED') {
      confirmation.value = null;
      failure.value = 'The client changed. Reload its credential status before trying again.';
    } else {
      failure.value = adminRequestMessage(reason, fallback);
    }
  }

  function editCallback(client: Client): void {
    confirmation.value = null;
    failure.value = null;
    notice.value = null;
    callbackClient.value = client;
    callbackUrl.value = client.redirectUris.at(firstCallback) ?? '';
  }

  function reviewCallback(): void {
    const client = callbackClient.value;
    if (client && !blocked.value) {
      confirmation.value = {
        kind: 'client',
        operation: 'replace-callback',
        client,
        redirectUri: callbackUrl.value,
      };
    }
  }

  function closeCallback(): void {
    confirmation.value = null;
    callbackClient.value = null;
    callbackUrl.value = '';
  }

  async function load(): Promise<void> {
    if (blocked.value) {
      return;
    }

    loading.value = true;
    closeCallback();
    failure.value = null;

    try {
      overview.value = await $fetch<Overview>('/api/auth/admin/access', {
        method: 'POST',
        retry: 0,
        body: {
          collection: 'credentials',
          installationId: props.installationId,
        },
      });
    } catch (error) {
      overview.value = null;
      reportFailure(safeParse(adminErrorSchema, error), 'Could not load credential status.');
    } finally {
      loading.value = false;
    }
  }

  async function changeClient(change: ClientOperation): Promise<void> {
    const state = overview.value;
    if (!state) {
      return;
    }

    const { client, operation } = change;
    const target = {
      clientId: client.clientId,
      expectedVersion: client.credentialVersion,
    };
    const result = await $fetch<ClientResult>(adminInteractionEndpoint, {
      method: 'POST',
      retry: 0,
      body:
        operation === 'replace-callback'
          ? {
              ...target,
              action: operation,
              redirectUri: change.redirectUri,
            }
          : {
              ...target,
              action: 'manage-client',
              operation,
            },
    });
    const updated: Client = {
      ...client,
      disabled: result.action === 'disable',
      redirectUris:
        result.action === 'replace-callback' ? [result.redirectUri] : client.redirectUris,
      credentialVersion:
        result.action === 'disable' ? client.credentialVersion : result.credentialVersion,
    };
    overview.value = {
      ...state,
      clients: state.clients.map((item) => (item.clientId === client.clientId ? updated : item)),
    };

    if (result.action === 'replace-callback') {
      closeCallback();
      notice.value = 'Callback updated.';
      return;
    }

    emit('client-changed', client.clientId);

    if (result.action === 'rotate-secret') {
      revealed.value = {
        label: 'New client secret',
        secret: result.clientSecret,
      };
    } else {
      notice.value = 'OAuth client disabled.';
    }
  }

  async function changeMachine(change: MachineChange): Promise<void> {
    const state = overview.value;
    if (!state?.machine) {
      return;
    }

    const result = await $fetch<MachineResult>(adminInteractionEndpoint, {
      method: 'POST',
      retry: 0,
      body: {
        action: 'manage-machine-key',
        change: {
          ...change,
          installationId: props.installationId,
        },
      },
    });

    if (result.action === 'revoke') {
      overview.value = {
        ...state,
        machine: { activeKey: null },
      };
      notice.value = 'Machine key revoked.';
      return;
    }

    overview.value = {
      ...state,
      machine: {
        activeKey: {
          keyId: result.keyId,
          expiresAt: result.expiresAt,
        },
      },
    };
    revealed.value = {
      label: 'New machine key',
      secret: result.key,
    };
  }

  async function run(operation: Operation): Promise<void> {
    if (blocked.value) {
      return;
    }

    saving.value = true;
    emit('write-pending', true);
    confirmation.value = null;
    notice.value = null;
    failure.value = null;

    try {
      await (operation.kind === 'client'
        ? changeClient(operation)
        : changeMachine(operation.change));
    } catch (error) {
      const parsed = safeParse(adminErrorSchema, error);
      if (
        operation.kind === 'client' &&
        operation.operation === 'replace-callback' &&
        parsed.success &&
        parsed.output.statusCode === badRequest
      ) {
        failure.value = 'Use an exact HTTPS callback URL without credentials or a fragment.';
      } else {
        reportFailure(
          parsed,
          'Could not update credentials. Reload credential status before retrying.',
        );
      }
    } finally {
      saving.value = false;
      emit('write-pending', false);
    }
  }

  onMounted(load);
</script>

<template>
  <UCard aria-labelledby="application-credentials">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="application-credentials"
          class="font-semibold"
        >
          Credential management
        </h3>

        <UButton
          :disabled="blocked"
          label="Reload credential status"
          size="sm"
          variant="ghost"
          @click="load"
        />
      </div>
    </template>

    <div class="space-y-4">
      <UAlert
        v-if="failure"
        :description="failure"
        color="error"
        role="alert"
      />

      <UAlert
        v-if="notice"
        :description="notice"
        color="success"
        role="status"
      />

      <div
        v-if="revealed"
        class="space-y-2 border border-default bg-elevated p-4"
      >
        <h4 class="font-semibold">{{ revealed.label }}</h4>

        <p class="text-sm text-muted">
          Store this credential in your server’s secret store before leaving this panel.
        </p>

        <code class="block text-sm break-all">{{ revealed.secret }}</code>

        <UButton
          label="Dismiss credential"
          color="neutral"
          variant="outline"
          @click="revealed = null"
        />
      </div>

      <div
        v-if="overview"
        class="space-y-4"
      >
        <section
          aria-label="OAuth clients"
          class="space-y-2"
        >
          <h4 class="text-sm font-semibold">OAuth clients</h4>

          <ul
            v-if="overview.clients.length"
            class="divide-y divide-default"
          >
            <li
              v-for="client in overview.clients"
              :key="client.clientId"
              class="space-y-2 py-2"
            >
              <code class="block text-xs break-all">{{ client.clientId }}</code>
              <p class="text-sm text-muted">{{ client.disabled ? 'Disabled' : 'Enabled' }}</p>

              <ul
                aria-label="Registered callbacks"
                class="space-y-1"
              >
                <li
                  v-for="redirectUri in client.redirectUris"
                  :key="redirectUri"
                >
                  <code class="block text-xs break-all">{{ redirectUri }}</code>
                </li>
              </ul>

              <div
                v-if="!client.disabled"
                class="flex flex-wrap gap-2"
              >
                <UButton
                  :disabled="blocked"
                  label="Edit callback"
                  variant="outline"
                  @click="editCallback(client)"
                />

                <UButton
                  :disabled="blocked"
                  label="Rotate client secret"
                  variant="outline"
                  @click="confirmation = { kind: 'client', operation: 'rotate-secret', client }"
                />

                <UButton
                  :disabled="blocked"
                  label="Disable client"
                  color="error"
                  variant="outline"
                  @click="confirmation = { kind: 'client', operation: 'disable', client }"
                />
              </div>

              <form
                v-if="callbackClient?.clientId === client.clientId"
                class="space-y-3"
                @submit.prevent="reviewCallback"
              >
                <UFormField label="New HTTPS callback URL">
                  <UInput
                    v-model="callbackUrl"
                    :disabled="
                      blocked ||
                      (confirmation?.kind === 'client' &&
                        confirmation.operation === 'replace-callback')
                    "
                    :maxlength="maximumCallbackLength"
                    type="url"
                    class="w-full"
                    required
                  />
                </UFormField>

                <div class="flex flex-wrap gap-2">
                  <UButton
                    :disabled="blocked"
                    label="Review callback change"
                    type="submit"
                  />

                  <UButton
                    :disabled="saving"
                    label="Cancel edit"
                    variant="ghost"
                    @click="closeCallback"
                  />
                </div>
              </form>
            </li>
          </ul>

          <p
            v-else
            class="text-sm text-muted"
          >
            No registered OAuth clients.
          </p>
        </section>

        <section
          v-if="overview.machine"
          aria-label="Machine key"
          class="space-y-2 border-t border-default pt-4"
        >
          <h4 class="text-sm font-semibold">Machine key</h4>

          <template v-if="overview.machine.activeKey">
            <p class="text-sm text-muted">
              Expires
              <NuxtTime
                :datetime="overview.machine.activeKey.expiresAt"
                date-style="medium"
                time-style="short"
              />
            </p>

            <div class="flex flex-wrap gap-2">
              <UButton
                :disabled="blocked"
                label="Rotate machine key"
                variant="outline"
                @click="
                  confirmation = {
                    kind: 'machine',
                    change: { action: 'rotate', keyId: overview.machine.activeKey.keyId },
                  }
                "
              />

              <UButton
                :disabled="blocked"
                label="Revoke machine key"
                color="error"
                variant="outline"
                @click="
                  confirmation = {
                    kind: 'machine',
                    change: { action: 'revoke', keyId: overview.machine.activeKey.keyId },
                  }
                "
              />
            </div>
          </template>

          <UButton
            v-else
            :disabled="blocked"
            label="Issue machine key"
            variant="outline"
            @click="run({ kind: 'machine', change: { action: 'issue' } })"
          />
        </section>
      </div>

      <section
        v-if="confirmation"
        class="space-y-2 border border-default p-4"
        aria-label="Confirm credential change"
      >
        <p class="text-sm">{{ confirmationText }}</p>

        <code
          v-if="confirmation.kind === 'client'"
          class="block text-xs break-all"
        >
          {{ confirmation.client.clientId }}
        </code>

        <code
          v-if="confirmation.kind === 'client' && confirmation.operation === 'replace-callback'"
          class="block text-xs break-all"
        >
          {{ confirmation.redirectUri }}
        </code>

        <div class="flex flex-wrap gap-2">
          <UButton
            :disabled="blocked"
            :label="`Confirm ${confirmationLabel.toLowerCase()}`"
            color="error"
            @click="run(confirmation)"
          />

          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="confirmation = null"
          />
        </div>
      </section>
    </div>
  </UCard>
</template>
