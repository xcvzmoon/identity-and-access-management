<script setup lang="ts">
  import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
  } from '@simplewebauthn/browser';
  import {
    browserSupportsWebAuthn,
    startAuthentication,
    startRegistration,
  } from '@simplewebauthn/browser';
  import { safeParse } from 'valibot';

  type AdminContext = {
    enrolled: boolean;
    verified: boolean;
    organizations: { id: string; name: string; owner: boolean }[];
  };
  type Registration = {
    clientId: string;
    clientSecret: string;
    installationId: string;
    tokenEndpointAuthMethod: ClientAuthMethod;
  };
  type RegisteredApp = { id: string; name: string; organizationId: string };
  type ClientAuthMethod = 'client_secret_basic' | 'client_secret_post';

  const clientAuthMethods = [
    {
      label: 'HTTP Basic',
      value: 'client_secret_basic',
    },
    {
      label: 'POST body',
      value: 'client_secret_post',
    },
  ] satisfies { label: string; value: ClientAuthMethod }[];

  const firstOrganization = 0;
  const initialMembershipRevision = 0;
  const revisionIncrement = 1;

  definePageMeta({ auth: 'user' });
  useHead({ title: 'App administration' });

  const admin = shallowRef<AdminContext | null>(null);
  const registration = shallowRef<Registration | null>(null);
  const registeredApp = shallowRef<RegisteredApp | null>(null);
  const password = shallowRef<string>('');
  const addingBackup = shallowRef<boolean>(false);
  const organizationId = shallowRef<string>('');
  const membershipRevision = shallowRef<number>(initialMembershipRevision);
  const applicationName = shallowRef<string>('');
  const redirectUri = shallowRef<string>('');
  const tokenEndpointAuthMethod = shallowRef<ClientAuthMethod>('client_secret_basic');
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);
  const notice = shallowRef<string | null>(null);
  const organizations = computed<{ label: string; value: string }[]>(
    () =>
      admin.value?.organizations.map(({ id, name }) => ({
        label: name,
        value: id,
      })) ?? [],
  );
  const appInOrganization = computed<RegisteredApp | null>(() =>
    registeredApp.value?.organizationId === organizationId.value ? registeredApp.value : null,
  );
  const ownsSelectedOrganization = computed<boolean>(() =>
    Boolean(admin.value?.organizations.find(({ id }) => id === organizationId.value)?.owner),
  );

  async function refresh(): Promise<void> {
    admin.value = await $fetch<AdminContext>(adminInteractionEndpoint, {
      method: 'POST',
      body: { action: 'context' },
    });

    if (!admin.value.organizations.some(({ id }) => id === organizationId.value)) {
      organizationId.value = admin.value.organizations.at(firstOrganization)?.id ?? '';
    }
  }

  function clearAdminVerification(): void {
    if (admin.value) {
      admin.value = {
        ...admin.value,
        verified: false,
      };
    }

    registration.value = null;
    addingBackup.value = false;
  }

  function requireVerification(): void {
    clearAdminVerification();
    error.value = 'Verify your passkey again to manage app access.';
  }

  function ownershipTransferred(): void {
    clearAdminVerification();
    error.value = null;
    notice.value =
      'Ownership transferred. Verify your passkey again to continue as an administrator.';
  }

  function clearRegistrationCredential(clientId: string): void {
    if (registration.value?.clientId === clientId) {
      registration.value = null;
    }
  }

  async function run(work: () => Promise<void>, fallback: string): Promise<void> {
    if (pending.value) {
      return;
    }

    pending.value = true;
    error.value = null;

    try {
      await work();
    } catch (error_) {
      const parsed = safeParse(adminErrorSchema, error_);
      const failure = parsed.success ? parsed.output : null;
      if (failure?.data?.code === 'PASSKEY_REQUIRED') {
        requireVerification();
      } else {
        error.value = adminRequestMessage(failure, fallback);
      }
    } finally {
      pending.value = false;
    }
  }

  function requireBrowserSupport(): void {
    if (!browserSupportsWebAuthn()) {
      throw new Error('Passkeys are unavailable');
    }
  }

  async function enrollPasskey(): Promise<void> {
    await run(async () => {
      requireBrowserSupport();

      try {
        const optionsJSON = await $fetch<PublicKeyCredentialCreationOptionsJSON>(
          adminInteractionEndpoint,
          {
            method: 'POST',
            body: {
              action: 'begin-enrollment',
              password: password.value,
            },
          },
        );
        const response = await startRegistration({ optionsJSON });
        await $fetch(adminInteractionEndpoint, {
          method: 'POST',
          body: {
            action: 'finish-enrollment',
            response,
          },
        });
        addingBackup.value = false;
        await refresh();
      } finally {
        password.value = '';
      }
    }, 'Could not create the passkey. Check your password and try again.');
  }

  async function verifyPasskey(): Promise<void> {
    await run(async () => {
      requireBrowserSupport();

      const optionsJSON = await $fetch<PublicKeyCredentialRequestOptionsJSON>(
        adminInteractionEndpoint,
        {
          method: 'POST',
          body: { action: 'begin-verification' },
        },
      );
      const response = await startAuthentication({ optionsJSON });
      await $fetch(adminInteractionEndpoint, {
        method: 'POST',
        body: {
          action: 'finish-verification',
          response,
        },
      });
      await refresh();
    }, 'Passkey verification failed.');
  }

  async function register(): Promise<void> {
    registration.value = null;
    await run(async () => {
      const name = applicationName.value.trim();
      const owner = organizationId.value;
      registration.value = await $fetch<Registration>(adminInteractionEndpoint, {
        method: 'POST',
        body: {
          action: 'register-app',
          organizationId: owner,
          name,
          redirectUri: redirectUri.value,
          tokenEndpointAuthMethod: tokenEndpointAuthMethod.value,
        },
      });
      registeredApp.value = {
        id: registration.value.installationId,
        name,
        organizationId: owner,
      };
      applicationName.value = '';
      redirectUri.value = '';
      tokenEndpointAuthMethod.value = 'client_secret_basic';
    }, 'Registration failed. Check the callback URL and verify your passkey again if needed.');
  }

  onMounted(async () => run(refresh, 'App administration is unavailable for your account.'));
</script>

<template>
  <main class="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-6 px-6 py-12">
    <header class="space-y-2">
      <NuxtLink
        to="/account"
        class="text-sm text-muted underline underline-offset-4"
      >
        Back to account
      </NuxtLink>

      <h1 class="text-3xl font-semibold tracking-tight">App administration</h1>
    </header>

    <UAlert
      v-if="error"
      :description="error"
      color="error"
      role="alert"
    />

    <UAlert
      v-if="notice"
      :description="notice"
      color="success"
      role="status"
    />

    <UCard v-if="admin">
      <template #header>
        <h2 class="font-semibold">Administrator passkey</h2>
      </template>

      <form
        v-if="!admin.enrolled || addingBackup"
        class="flex flex-col items-start gap-4"
        @submit.prevent="enrollPasskey"
      >
        <UFormField label="Current password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </UFormField>

        <UButton
          :loading="pending"
          label="Create a passkey"
          type="submit"
        />
      </form>

      <div
        v-else
        class="space-y-4"
      >
        <p class="text-sm text-muted">
          Verify your passkey to authorize app management for five minutes.
        </p>

        <div class="flex flex-wrap gap-3">
          <UButton
            :loading="pending"
            label="Verify passkey"
            @click="verifyPasskey"
          />

          <UButton
            v-if="admin.verified"
            :disabled="pending"
            label="Add backup passkey"
            color="neutral"
            variant="outline"
            @click="addingBackup = true"
          />
        </div>
      </div>
    </UCard>

    <template v-if="admin?.verified">
      <UFormField
        label="Organization"
        class="w-full sm:max-w-sm"
        required
      >
        <USelect
          v-model="organizationId"
          :items="organizations"
          :disabled="pending"
          class="w-full"
        />
      </UFormField>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <AdminAppAccessDashboard
          v-if="organizationId"
          :key="organizationId"
          :organization-id="organizationId"
          :registered-app="appInOrganization"
          :membership-revision="membershipRevision"
          @client-changed="clearRegistrationCredential"
          @require-verification="requireVerification"
        />

        <aside class="min-w-0 space-y-4">
          <UCard v-if="registration">
            <template #header>
              <h2 class="font-semibold">App credentials</h2>
            </template>

            <p class="mb-4 text-sm text-muted">
              Store the client secret now. IAM displays it once.
            </p>

            <dl class="space-y-3 text-sm">
              <div>
                <dt class="text-muted">Installation ID</dt>
                <dd><code class="break-all">{{ registration.installationId }}</code></dd>
              </div>

              <div>
                <dt class="text-muted">Client ID</dt>
                <dd><code class="break-all">{{ registration.clientId }}</code></dd>
              </div>

              <div>
                <dt class="text-muted">Client secret</dt>
                <dd><code class="break-all">{{ registration.clientSecret }}</code></dd>
              </div>

              <div>
                <dt class="text-muted">Client authentication</dt>
                <dd><code>{{ registration.tokenEndpointAuthMethod }}</code></dd>
              </div>
            </dl>

            <UButton
              class="mt-4"
              label="Dismiss credentials"
              variant="outline"
              color="neutral"
              @click="registration = null"
            />
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold">Register an app</h2>
            </template>

            <form
              class="space-y-4"
              @submit.prevent="register"
            >
              <UFormField
                label="App name"
                required
              >
                <UInput
                  v-model="applicationName"
                  class="w-full"
                  required
                />
              </UFormField>

              <UFormField
                label="HTTPS callback URL"
                required
              >
                <UInput
                  v-model="redirectUri"
                  class="w-full"
                  type="url"
                  required
                />
              </UFormField>

              <UFormField
                label="Client authentication"
                description="Choose POST body only if your integration requires it."
              >
                <USelect
                  v-model="tokenEndpointAuthMethod"
                  :items="clientAuthMethods"
                  class="w-full"
                />
              </UFormField>

              <UButton
                :loading="pending"
                label="Register"
                type="submit"
              />
            </form>
          </UCard>

          <AdminOrganizationInvitations
            v-if="organizationId"
            :key="organizationId"
            :organization-id="organizationId"
            @require-verification="requireVerification"
          />

          <AdminOrganizationMembers
            v-if="organizationId"
            :key="organizationId"
            :organization-id="organizationId"
            :owner="ownsSelectedOrganization"
            @require-verification="requireVerification"
            @status-changed="membershipRevision += revisionIncrement"
          />

          <AdminOwnershipTransfer
            v-if="organizationId && ownsSelectedOrganization"
            :key="organizationId"
            :organization-id="organizationId"
            @require-verification="requireVerification"
            @transferred="ownershipTransferred"
          />
        </aside>
      </div>
    </template>
  </main>
</template>
