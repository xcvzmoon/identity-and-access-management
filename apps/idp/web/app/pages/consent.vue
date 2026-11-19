<script setup lang="ts">
  import * as valibot from 'valibot';

  const nameSchema = valibot.pipe(valibot.string(), valibot.nonEmpty());
  const detailsSchema = valibot.object({
    name: nameSchema,
    organization: valibot.nullable(nameSchema),
    role: valibot.nullable(nameSchema),
    reference: nameSchema,
  });

  definePageMeta({ key: (route) => route.fullPath });

  const { error, pending, submit } = useAccountAction();
  const details = shallowRef<valibot.InferOutput<typeof detailsSchema> | null>(null);
  const loading = ref<boolean>(true);
  const query = useRequestURL().searchParams;
  const signedRequest = query.toString();
  const scopes = query.get('scope')?.split(/\s+/u).filter(Boolean) ?? [];

  async function decide(decision: 'allow' | 'deny'): Promise<void> {
    const grant = details.value;
    if (!grant) {
      return;
    }

    await submit(async () => {
      const response = await $fetch<unknown>('/api/v1/auth/oauth2/consent', {
        headers: { 'x-iam-consent-reference': grant.reference },
        method: 'POST',
        body: {
          accept: decision === 'allow',
          oauth_query: signedRequest,
        },
      });

      await followAuthorizationRedirect(valibot.parse(authorizationRedirectSchema, response));
    }, 'Unable to finish authorization. Reopen the application and try again.');
  }

  onMounted(async () => {
    await submit(async () => {
      const response = await $fetch<unknown>('/api/v1/app-consent/details', {
        method: 'POST',
        body: { oauth_query: signedRequest },
      });

      details.value = valibot.parse(detailsSchema, response);
    }, 'This authorization request is invalid or expired. Reopen the application to sign in.');

    loading.value = false;
  });
</script>

<template>
  <AccountPanel title="Confirm application access">
    <p
      v-if="loading"
      role="status"
    >
      Loading application details…
    </p>

    <div
      v-if="details"
      class="grid gap-4"
    >
      <p>
        Allow
        <strong>{{ details.name }}</strong>
        to sign you in?
      </p>

      <p v-if="details.organization && details.role">
        You will sign in to {{ details.organization }} with the role {{ details.role }}.
      </p>

      <p v-if="scopes.length">Requested permissions: {{ scopes.join(', ') }}</p>

      <div class="flex gap-3">
        <UButton
          :disabled="pending"
          label="Allow"
          @click="decide('allow')"
        />

        <UButton
          :disabled="pending"
          label="Deny"
          variant="outline"
          @click="decide('deny')"
        />
      </div>
    </div>

    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </AccountPanel>
</template>
