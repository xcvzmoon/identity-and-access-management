<script setup lang="ts">
  const { error, pending, submit } = useAccountAction();
  const message = ref('');

  async function requestCredential(
    ceremony: 'registration' | 'authentication',
  ): Promise<Credential | null> {
    if (ceremony === 'registration') {
      const options = await $fetch<PublicKeyCredentialCreationOptionsJSON>(
        '/api/v1/auth/passkey/generate-register-options',
      );

      return navigator.credentials.create({
        publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
      });
    }

    const options = await $fetch<PublicKeyCredentialRequestOptionsJSON>(
      '/api/v1/auth/passkey/generate-authenticate-options',
    );

    return navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    });
  }

  async function runCeremony(ceremony: 'registration' | 'authentication'): Promise<void> {
    message.value = '';

    await submit(async () => {
      const credential = await requestCredential(ceremony);
      if (!(credential instanceof PublicKeyCredential)) {
        throw new TypeError('The authenticator did not return a passkey.');
      }

      await $fetch(`/api/v1/auth/passkey/verify-${ceremony}`, {
        method: 'POST',
        body: { response: credential.toJSON() },
      });

      message.value =
        ceremony === 'registration'
          ? 'Passkey enrolled. Verify it to continue.'
          : 'Passkey verified. Return to your console to continue.';
    }, 'Unable to complete the passkey request. Sign in with your administrator account and try again. To add another passkey, verify an existing one first.');
  }
</script>

<template>
  <AccountPanel title="Administrator passkeys">
    <p>Verify a passkey to manage your organization for the next five minutes.</p>
    <UButton
      :disabled="pending"
      @click="runCeremony('authentication')"
    >
      Verify passkey
    </UButton>
    <UButton
      :disabled="pending"
      variant="outline"
      @click="runCeremony('registration')"
    >
      Enroll a passkey
    </UButton>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
    >
      {{ message }}
    </p>
    <NuxtLink to="/sign-in">Sign in to IAM</NuxtLink>
  </AccountPanel>
</template>
